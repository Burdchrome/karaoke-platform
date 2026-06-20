// /api/queue — read, add, remove.
//
// Each entry returned to the client is enriched with the song's metadata
// (artist, title, etc.) via the shared helper in queue.js so it matches what
// the SSE endpoint sends.

import express from 'express';
import { listQueue, addToQueue, removeFromQueue, moveEntry, enrichQueueEntry } from '../queue.js';

export function makeQueueRouter(songsById) {
  const router = express.Router();
  router.use(express.json());

  const enrich = (entry) => enrichQueueEntry(entry, songsById);

  router.get('/', (req, res) => {
    res.json({ queue: listQueue().map(enrich) });
  });

  router.post('/', (req, res) => {
    const { songId, requestedBy } = req.body || {};
    if (typeof songId !== 'string' || !songId) {
      return res.status(400).json({ error: 'songId is required' });
    }
    if (!songsById.has(songId)) {
      return res.status(404).json({ error: 'unknown songId' });
    }
    const entry = addToQueue(songId, requestedBy);
    res.status(201).json({ entry: enrich(entry) });
  });

  router.delete('/:entryId', (req, res) => {
    const removed = removeFromQueue(req.params.entryId);
    if (!removed) return res.status(404).json({ error: 'entry not found' });
    res.json({ removed: enrich(removed) });
  });

  // Move a queue entry to a new 0-based position. Used by drag-to-reorder.
  router.post('/move', (req, res) => {
    const { entryId, newPosition } = req.body || {};
    if (typeof entryId !== 'string' || typeof newPosition !== 'number') {
      return res.status(400).json({ error: 'entryId (string) and newPosition (number) required' });
    }
    const moved = moveEntry(entryId, newPosition);
    if (!moved) return res.status(404).json({ error: 'entry not found' });
    res.json({ moved: enrich(moved) });
  });

  return router;
}
