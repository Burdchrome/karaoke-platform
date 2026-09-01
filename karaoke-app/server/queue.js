// In-memory queue state for v1.
//
// Single shared queue (one venue, one queue). State is lost on server restart —
// acceptable for v1.0; persistence (SQLite or JSON-on-disk) is a Phase 2 polish.
//
// Each entry has its own short ID so removals are stable even if positions shift.
//
// Step 9: exports a `queueEvents` EventEmitter that fires `'change'` after every
// mutation. The SSE route listens to it and broadcasts to connected clients.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

const state = {
  queue: [], // [{ id, songId, addedAt }]
};

export const queueEvents = new EventEmitter();

function newEntryId() {
  return crypto.randomBytes(6).toString('hex'); // 12-char id, plenty
}

export function listQueue() {
  return state.queue.slice(); // shallow copy so callers can't mutate
}

export function addToQueue(songId, requestedBy = '') {
  const entry = {
    id: newEntryId(),
    songId,
    requestedBy: typeof requestedBy === 'string' ? requestedBy.trim().slice(0, 80) : '',
    addedAt: new Date().toISOString(),
  };
  state.queue.push(entry);
  logger.info('queue:add', {
    entryId: entry.id, songId,
    requestedBy: entry.requestedBy || undefined,
    queueLength: state.queue.length,
  });
  queueEvents.emit('change');
  return entry;
}

export function removeFromQueue(entryId) {
  const idx = state.queue.findIndex(e => e.id === entryId);
  if (idx === -1) return null;
  const [removed] = state.queue.splice(idx, 1);
  logger.info('queue:remove', { entryId, songId: removed.songId, queueLength: state.queue.length });
  queueEvents.emit('change');
  return removed;
}

export function clearQueue() {
  const n = state.queue.length;
  state.queue = [];
  logger.info('queue:clear', { removed: n });
  if (n > 0) queueEvents.emit('change');
  return n;
}

/**
 * Move a queue entry to a new position (atomic single-move).
 * newPosition is the 0-based target index.
 * Clamps out-of-range positions to the valid range.
 * Returns the entry on success, or null if entryId isn't in the queue.
 */
export function moveEntry(entryId, newPosition) {
  const oldIndex = state.queue.findIndex(e => e.id === entryId);
  if (oldIndex === -1) return null;

  // Clamp to [0, queue.length - 1].
  const clamped = Math.max(0, Math.min(state.queue.length - 1, Number(newPosition) || 0));
  if (clamped === oldIndex) return state.queue[oldIndex]; // no-op

  const [entry] = state.queue.splice(oldIndex, 1);
  state.queue.splice(clamped, 0, entry);
  logger.info('queue:move', { entryId, from: oldIndex, to: clamped });
  queueEvents.emit('change');
  return entry;
}

/**
 * Advance the queue: remove and return the head entry, or null if empty.
 * This is the ONE way "play the next song" consumes the queue — the entry is
 * gone the moment this returns, so no two callers can ever be handed the same
 * head (each request handler runs this synchronously to completion).
 */
export function advanceQueue() {
  const entry = state.queue.shift();
  if (!entry) return null;
  logger.info('queue:advance', { entryId: entry.id, songId: entry.songId, queueLength: state.queue.length });
  queueEvents.emit('change');
  return entry;
}

/**
 * Turn a raw queue entry into the client-shaped payload (with song metadata).
 * Shared between the REST and SSE routes so both serve identical objects —
 * the client doesn't need separate render paths.
 */
export function enrichQueueEntry(entry, songsById) {
  const song = songsById.get(entry.songId);
  if (!song) return { ...entry, song: null };
  return {
    ...entry,
    song: {
      id: song.id,
      artist: song.artist,
      title: song.title,
      discCode: song.discCode,
      filename: song.filename,
    },
  };
}
