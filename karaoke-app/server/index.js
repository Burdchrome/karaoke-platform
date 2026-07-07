// Karaoke server entrypoint.
// Steps 3-5: placeholder UI + library scanner + search + streaming.
// Step 6 will add the synced CDG+MP3 player to the UI.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { loadLibrary } from './library.js';
import { makeSongsRouter } from './routes/songs.js';
import { makeStreamRouter } from './routes/stream.js';
import { makeQueueRouter } from './routes/queue.js';
import { makeEventsRouter } from './routes/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();

// ----- DJ auth -----
//
// Basic Auth gate for DJ-only surfaces: the /dj page itself, queue mutations,
// and the SSE stream. Audience pages and read-only song endpoints stay open.
//
// Set credentials via env vars when starting the server. If DJ_PASS is not
// set, auth is disabled (matches the local-only development behavior we've
// been using). When you tunnel to the public internet, ALWAYS set DJ_PASS.
//
//   Git Bash:    DJ_USER=shooter DJ_PASS='something-long' npm start
//   PowerShell:  $env:DJ_USER='shooter'; $env:DJ_PASS='something-long'; npm start

const DJ_USER = process.env.DJ_USER || 'dj';
const DJ_PASS = process.env.DJ_PASS || '';

function djAuth(req, res, next) {
  if (!DJ_PASS) return next(); // auth disabled — local-dev mode

  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === DJ_USER && p === DJ_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Karaoke List DJ"');
  res.status(401).send('Authentication required.');
}

if (DJ_PASS) {
  logger.info('DJ auth: ENABLED');
} else {
  logger.warn('DJ auth: DISABLED (no DJ_PASS env var). Do not tunnel without setting it.');
}

app.use(express.static(PUBLIC_DIR));

// DJ view at /dj — auth-gated.
app.get('/dj', djAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dj.html'));
});

// Serve the cdgraphics ESM bundle directly from node_modules so the browser
// can import it without a separate build step. Keeps the project dependency-
// minimal and lets `npm install` stay the source of truth.
app.use(
  '/libs/cdgraphics',
  express.static(path.join(__dirname, '..', 'node_modules', 'cdgraphics', 'dist'))
);
app.use(
  '/libs/sortablejs',
  express.static(path.join(__dirname, '..', 'node_modules', 'sortablejs', 'modular'))
);

// Load library before listening. Built from cache after first scan.
// Sorted artist → title so search results group naturally. Blank-artist
// entries sort last instead of topping every list.
const allSongs = (await loadLibrary()).sort((a, b) =>
  (a.artist || '￿').localeCompare(b.artist || '￿') || a.title.localeCompare(b.title)
);

// Dedupe at load: the drive has whole folders copied around, so ~1/3 of
// entries are extra copies of the same artist+title. Keep the first copy,
// count the rest as `versions`. Blank-artist entries key on filename so
// unrelated songs that share a title don't collapse into each other.
// The cache keeps every copy — rescan-free and reversible by deleting this block.
// ponytail: picks an arbitrary version; add a version picker if Shooter
// ever asks for a specific disc.
const seen = new Map();
for (const s of allSongs) {
  const key = `${(s.artist || s.filename).toLowerCase()}|${s.title.toLowerCase()}`;
  const first = seen.get(key);
  if (first) first.versions++;
  else seen.set(key, Object.assign(s, { versions: 1 }));
}
const songs = [...seen.values()];
logger.info(`Deduped ${allSongs.length} entries → ${songs.length} unique songs`);

// O(1) lookup by id for the stream route. The array is for ordered iteration
// (search), the map is for direct addressing (streaming).
const songsById = new Map(songs.map(s => [s.id, s]));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    songCount: songs.length,
  });
});

app.use('/api/songs', makeSongsRouter(songs));
app.use('/api/stream', makeStreamRouter(songsById));
app.use('/api/queue',  djAuth, makeQueueRouter(songsById));
app.use('/api/events', djAuth, makeEventsRouter(songsById));

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Karaoke server listening on http://localhost:${PORT}`);
  logger.info(`From other devices on Wi-Fi: http://<this-laptop-ip>:${PORT}`);
});
