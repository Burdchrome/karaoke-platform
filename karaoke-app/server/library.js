// Library scanner.
//
// Responsibility: walk E:\karaoke once, find every .mp3 that has a sibling .cdg,
// parse the filename into artist/title, and return an in-memory array of song objects.
//
// Caching: the scan reads 130k+ files from a USB drive (~72 seconds). We cache
// the result to library-cache.json in the project root. Subsequent startups are
// instant. Set FORCE_RESCAN=1 in the environment to rebuild the cache.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from './logger.js';

const LIBRARY_ROOT = process.env.LIBRARY_ROOT || 'E:\\karaoke';
const CACHE_FILE = path.join(process.cwd(), 'library-cache.json');

/**
 * Walk a directory recursively and return all file paths.
 * We do this manually (not glob) to keep dependencies minimal.
 */
async function walk(dir, results = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn(`Could not read directory: ${dir}`, { error: err.message });
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Phase 3a parser.
 *
 * Three passes:
 *   1. Disc code at the END of the filename (e.g. "Adele - Hello - 50052")
 *   2. Disc code at the START (the original common case)
 *   3. Fallback: dump everything into title
 *
 * On top of that, we use a small prefix-to-field-order table for prefixes
 * that we've empirically seen put Title before Artist (the All-Star
 * Karaoke "A" / "M" series, etc.).
 *
 * Also normalizes "Last, First" → "First Last" so the display reads
 * naturally for packs that use the comma-flipped name format.
 *
 * Returns { artist, title, discCode }.
 */

// Disc-code prefixes where the order is DISC - TITLE - ARTIST (not the usual
// DISC - ARTIST - TITLE). Add to this list as more are discovered.
const TITLE_FIRST_PREFIXES = new Set([
  'A',     // All-Star Karaoke mainstream
  'AD',    // Adult parodies
  'DKM',   // DK something
  'EK',    // EKaraoke?
  'G',     // GMX?
  'M',     // All-Star "M" series
  'TU',    // Top Hits Tunes?
  'ZMP',   // Zoom Karaoke
]);

function normalizeName(s) {
  if (!s) return s;
  // "Last, First" → "First Last". Be conservative: only flip if the comma is
  // followed by a space and looks like a name (no other commas, no parens).
  const m = s.match(/^([A-Z][A-Za-z'.\- ]+),\s+([A-Z][A-Za-z'.\- ]+)$/);
  if (m) return `${m[2]} ${m[1]}`;
  return s;
}

function parseFilename(basename) {
  const s = basename.trim();

  // ---- Pass 1: disc code at the END (numeric, after the final " - ") ----
  // Examples:
  //   "Adele - Hello - 50052"
  //   "Cher - You Haven t Seen The Last Of Me - 35262"
  // Heuristic: if the last segment after " - " is purely digits (4+),
  // treat it as the disc code and the rest as "Artist - Title".
  const endDisc = s.match(/^(.+?)\s+-\s+(.+?)\s+-\s+(\d{4,})$/);
  if (endDisc) {
    const [, artist, title, disc] = endDisc;
    return {
      artist: normalizeName(artist.trim()),
      title: title.trim(),
      discCode: disc,
    };
  }

  // ---- Pass 2: disc code at the START (the dominant pattern) ----
  // Disc codes contain at least one digit and use alphanum + dash + underscore.
  // Two-stage start match:
  //  (a) Greedy with " - " (space-dash-space) so the LAST proper separator
  //      becomes the title boundary. Preserves dash-in-name artists
  //      ("Ne-Yo", "K-Ci & JoJo", "T-Pain"). Doesn't match if the file uses
  //      a tight dash like "X-Y".
  //  (b) Non-greedy fallback for files that use tighter punctuation
  //      ("MM6398-13-PRESLEY, ELVIS-GIRL OF MINE" etc.).
  let startMatch = s.match(/^([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\s*-\s*(.+)\s+-\s+(.+)$/);
  if (!startMatch) {
    startMatch = s.match(/^([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\s*-\s*(.+?)\s*-\s*(.+)$/);
  }
  if (startMatch) {
    const [, disc, middle, last] = startMatch;
    // Find the alphabetic prefix (the letters before the first digit) to look
    // up in our title-first table.
    const prefix = (disc.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    const isTitleFirst = TITLE_FIRST_PREFIXES.has(prefix);
    if (isTitleFirst) {
      return {
        artist: normalizeName(last.trim()),
        title: middle.trim(),
        discCode: disc.trim(),
      };
    }
    return {
      artist: normalizeName(middle.trim()),
      title: last.trim(),
      discCode: disc.trim(),
    };
  }

  // ---- Pass 3: no disc code at all — just "Artist - Title" ----
  // Catches "Beatles, The - Across The Universe", "Madonna - American Life", etc.
  // Greedy split on the LAST " - " so dash-in-name artists survive.
  const noDisc = s.match(/^(.+)\s+-\s+(.+)$/);
  if (noDisc) {
    const [, left, right] = noDisc;
    // Heuristic: if the left side has digits in it (could be a malformed
    // disc-code attempt), be cautious — treat the whole thing as title.
    if (!/\d{3,}/.test(left)) {
      return {
        artist: normalizeName(left.trim()),
        title: right.trim(),
        discCode: '',
      };
    }
  }

  // ---- Pass 4: fallback — give up, dump as title ----
  return {
    artist: '',
    title: s,
    discCode: '',
  };
}

/**
 * Generate a stable, short ID from the full path so the same song always has
 * the same URL. SHA-1 truncated to 12 chars is plenty for 62k songs (collision
 * risk effectively zero).
 */
function makeId(fullPath) {
  return crypto.createHash('sha1').update(fullPath.toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Pair MP3s with sibling CDGs and build the song index.
 */
function buildIndex(filePaths) {
  const mp3Map = new Map(); // key: dir + basename (lowercase), value: mp3 path
  const cdgMap = new Map();

  for (const filePath of filePaths) {
    // IMPORTANT: use the file's actual (case-preserved) extension when stripping
    // the basename, because path.basename's suffix-match is case-sensitive.
    // Some karaoke packs ship files as SONG.MP3 / SONG.CDG (uppercase).
    const rawExt = path.extname(filePath);
    const ext = rawExt.toLowerCase();
    if (ext !== '.mp3' && ext !== '.cdg') continue;
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, rawExt).toLowerCase();
    const key = `${dir.toLowerCase()}|${base}`;
    if (ext === '.mp3') mp3Map.set(key, filePath);
    else cdgMap.set(key, filePath);
  }

  const songs = [];
  for (const [key, mp3Path] of mp3Map) {
    const cdgPath = cdgMap.get(key);
    if (!cdgPath) continue; // skip audio-only orphans for v0
    const basename = path.basename(mp3Path, path.extname(mp3Path));
    const { artist, title, discCode } = parseFilename(basename);
    songs.push({
      id: makeId(mp3Path),
      mp3Path,
      cdgPath,
      filename: basename,
      artist,
      title,
      discCode,
    });
  }

  return songs;
}

/**
 * Try to load a previously-built index from disk.
 * Returns null if cache is missing or unreadable.
 */
async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.songs)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function saveCache(payload) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload), 'utf8');
}

/**
 * Public entrypoint. Loads the song index, scanning the drive only if needed.
 */
export async function loadLibrary() {
  const forceRescan = process.env.FORCE_RESCAN === '1';

  if (!forceRescan) {
    const cached = await loadCache();
    if (cached) {
      logger.info(`Loaded ${cached.songs.length} songs from cache (${CACHE_FILE})`);
      logger.info(`Set FORCE_RESCAN=1 to rebuild the cache.`);
      return cached.songs;
    }
  }

  logger.info(`Scanning ${LIBRARY_ROOT} for the first time — this can take a minute or two on USB.`);
  const start = Date.now();

  const allFiles = await walk(LIBRARY_ROOT);
  logger.info(`Walked ${allFiles.length} files in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  const songs = buildIndex(allFiles);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`Indexed ${songs.length} paired songs in ${elapsed}s`);

  await saveCache({ generatedAt: new Date().toISOString(), root: LIBRARY_ROOT, songs });
  logger.info(`Cache written to ${CACHE_FILE}`);

  return songs;
}
