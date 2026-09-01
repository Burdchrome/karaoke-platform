// Regression guard for the queue's advance operation (born as the red test
// from the Ousterhout ch. 4 lens pass, 2026-08-31).
//
// Before POST /api/queue/advance existed, "play the next song" was a
// client-side compound (GET the queue, DELETE the head with the status
// unchecked, play it) — not atomic, so two DJ tabs hitting Skip both read
// the same head and double-played it. This file failed red against that
// workflow, then turned green when the server-side atomic advance landed.
//
// The assertions are the SPEC: each advance yields a distinct entry, N
// advances consume N entries, and stale entries are skipped server-side.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { makeQueueRouter } from './routes/queue.js';
import { addToQueue, clearQueue } from './queue.js';

// Minimal two-song library — enough to enrich queue entries.
const songsById = new Map([
  ['song-a', { id: 'song-a', artist: 'Thomas, Carl', title: 'Summer Rain', discCode: 'THP0012-11', filename: 'a' }],
  ['song-b', { id: 'song-b', artist: 'Nicks, Stevie', title: 'Everyday', discCode: 'THP0108-18', filename: 'b' }],
]);

async function startServer() {
  const app = express();
  app.use('/api/queue', makeQueueRouter(songsById));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

// Mirror of the DJ client's advance workflow (public/app.js djAdvance).
// Returns the songId this client ended up playing, or null on empty queue.
async function djAdvance(base) {
  const r = await fetch(`${base}/api/queue/advance`, { method: 'POST' });
  const { entry } = await r.json();
  return entry ? entry.song.id : null; // openPlayer(entry.song.id, ...)
}

test('sequential advances play each queued song exactly once (sanity — passes today)', async () => {
  clearQueue();
  const { server, base } = await startServer();
  try {
    addToQueue('song-a');
    addToQueue('song-b');

    const first = await djAdvance(base);
    const second = await djAdvance(base);

    assert.deepEqual([first, second], ['song-a', 'song-b']);
    const { queue } = await (await fetch(`${base}/api/queue`)).json();
    assert.equal(queue.length, 0);
  } finally {
    server.close();
  }
});

test('advance skips stale entries (songId no longer in the library)', async () => {
  clearQueue();
  const { server, base } = await startServer();
  try {
    addToQueue('song-gone'); // not in songsById — e.g. cache stale, file moved
    addToQueue('song-b');

    const played = await djAdvance(base);

    assert.equal(played, 'song-b');
    const { queue } = await (await fetch(`${base}/api/queue`)).json();
    assert.equal(queue.length, 0, 'stale entry should be consumed, not left behind');
  } finally {
    server.close();
  }
});

test('concurrent advances (two DJ tabs hit Skip) each play a distinct song', async () => {
  clearQueue();
  const { server, base } = await startServer();
  try {
    addToQueue('song-a');
    addToQueue('song-b');

    // Both tabs' advance workflows run concurrently: both GETs are dispatched
    // before either client has a head to DELETE, so both see song-a at the
    // head — the interleaving a real double-Skip produces.
    const played = await Promise.all([djAdvance(base), djAdvance(base)]);

    // Invariant 1: no entry is played twice.
    assert.notEqual(played[0], played[1],
      `both advances played ${played[0]} — the head was handed out twice`);

    // Invariant 2: two advances consume two entries.
    const { queue } = await (await fetch(`${base}/api/queue`)).json();
    assert.equal(queue.length, 0,
      `queue still holds ${queue.length} entr(y/ies) after two advances`);
  } finally {
    server.close();
  }
});
