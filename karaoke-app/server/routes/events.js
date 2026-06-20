// /api/events — Server-Sent Events (SSE) endpoint.
//
// One long-lived HTTP response per client. Whenever the queue changes
// (queueEvents emits 'change'), we re-broadcast the full enriched queue to
// every connected client. EventSource on the browser side handles reconnects.
//
// We send a heartbeat comment line every 25 seconds. SSE comments (lines that
// start with ":") are ignored by the client but keep proxies and corporate
// firewalls from timing out idle connections.

import express from 'express';
import { listQueue, enrichQueueEntry, queueEvents } from '../queue.js';
import { logger } from '../logger.js';

const HEARTBEAT_MS = 25_000;

export function makeEventsRouter(songsById) {
  const router = express.Router();

  // All currently-connected client response streams.
  const subscribers = new Set();

  function snapshot() {
    return { queue: listQueue().map(e => enrichQueueEntry(e, songsById)) };
  }

  function sendEvent(res, eventName, data) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      // Connection dead; let the close handler clean it up.
      subscribers.delete(res);
    }
  }

  function broadcastQueue() {
    const data = snapshot();
    for (const res of subscribers) sendEvent(res, 'queue', data);
  }

  // One listener for the whole router, not one per connection.
  queueEvents.on('change', broadcastQueue);

  // Heartbeat. A single timer for all subscribers.
  setInterval(() => {
    for (const res of subscribers) {
      try { res.write(': heartbeat\n\n'); } catch { subscribers.delete(res); }
    }
  }, HEARTBEAT_MS);

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // express-static-friendly: ensure no buffering.
    res.flushHeaders?.();

    // Send the current queue immediately so the client doesn't have to do
    // a separate /api/queue fetch on connect.
    sendEvent(res, 'queue', snapshot());

    subscribers.add(res);
    logger.info('sse:connect', { subscribers: subscribers.size });

    req.on('close', () => {
      subscribers.delete(res);
      logger.info('sse:disconnect', { subscribers: subscribers.size });
    });
  });

  return router;
}
