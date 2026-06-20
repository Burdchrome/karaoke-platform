// /api/stream/:id/:type — stream a single MP3 or CDG file with byte-range support.
//
// Byte-range support (HTTP 206 Partial Content) is required for:
//   - HTML5 <audio> seeking (clicking the progress bar)
//   - Some browsers (Safari especially) refuse to play if the server doesn't
//     advertise ranges
//   - Large CDG files where the player wants to fetch chunks
//
// We use res.sendFile, which Express implements via the `send` library — that
// already handles If-Modified-Since, Range, content-type, etc. We just need to
// pass the right options and look up the right path.

import express from 'express';
import { logger } from '../logger.js';

export function makeStreamRouter(songsById) {
  const router = express.Router();

  router.get('/:id/:type', (req, res) => {
    const { id, type } = req.params;
    const song = songsById.get(id);

    if (!song) {
      logger.warn(`Stream: unknown song id`, { id });
      return res.status(404).json({ error: 'song not found' });
    }

    let filePath, contentType;
    if (type === 'mp3') {
      filePath = song.mp3Path;
      contentType = 'audio/mpeg';
    } else if (type === 'cdg') {
      filePath = song.cdgPath;
      contentType = 'application/octet-stream'; // CDG has no registered MIME type
    } else {
      return res.status(400).json({ error: 'type must be mp3 or cdg' });
    }

    // Explicit headers — sendFile will add Content-Length / Accept-Ranges itself.
    res.setHeader('Content-Type', contentType);

    res.sendFile(filePath, { acceptRanges: true, dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) {
        logger.error(`Stream error`, { id, type, err: err.message });
        res.status(500).end();
      }
    });
  });

  return router;
}
