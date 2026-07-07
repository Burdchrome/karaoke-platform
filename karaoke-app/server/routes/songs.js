// /api/songs — search and list.
//
// Accepts: search (string), limit (number, default 50, max 200)
// Returns: { total, matched, results: [{ id, artist, title, discCode, filename }] }
//
// Matching is a case-insensitive substring search across artist, title, filename,
// and disc code. We search the filename too so that the v0 filename-parsing
// imperfections (artist/title sometimes swapped) don't hide songs from users.

import express from 'express';

export function makeSongsRouter(songs) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const q = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let matches;
    if (!q) {
      matches = songs;
    } else {
      matches = songs.filter(s =>
        s.artist.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.filename.toLowerCase().includes(q) ||
        s.discCode.toLowerCase().includes(q)
      );
    }

    res.json({
      total: songs.length,
      matched: matches.length,
      results: matches.slice(0, limit).map(({ id, artist, title, discCode, filename, versions }) => ({
        id, artist, title, discCode, filename, versions,
      })),
    });
  });

  return router;
}
