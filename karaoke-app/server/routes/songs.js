// /api/songs — search and list.
//
// Accepts: search (string), limit (number, default 50, max 200)
// Returns: { total, matched, results: [{ id, artist, title, discCode, versions:
//           [{ id, artist, title, discCode, versionLabel, filename }] }] }
//
// Results are one entry per song group (grouped by songKey — see groupSongs in
// library.js). Matching is still a case-insensitive substring search PER FILE
// across artist, title, filename, and disc code: a match on ANY version of a
// group surfaces the whole group. We search the filename too so filename-parsing
// imperfections (artist/title sometimes swapped) don't hide songs from users.

import express from 'express';

export function makeSongsRouter(songGroups) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const q = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let matches;
    if (!q) {
      matches = songGroups;
    } else {
      matches = songGroups.filter(group =>
        group.versions.some(v =>
          v.artist.toLowerCase().includes(q) ||
          v.title.toLowerCase().includes(q) ||
          v.filename.toLowerCase().includes(q) ||
          v.discCode.toLowerCase().includes(q)
        )
      );
    }

    res.json({
      total: songGroups.length,
      matched: matches.length,
      results: matches.slice(0, limit).map(({ id, artist, title, discCode, versions }) => ({
        id, artist, title, discCode, versions,
      })),
    });
  });

  return router;
}
