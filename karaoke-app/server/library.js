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
// DISC - ARTIST - TITLE). Some of these packs are mixed-order (DKM/ZMP/TU),
// so within them the comma-shape check in parseFilename overrides the table.
export const TITLE_FIRST_PREFIXES = new Set([
  'A',     // All-Star Karaoke mainstream
  'AD',    // Adult parodies
  'DKM',   // DK something
  'EK',    // EKaraoke?
  'G',     // GMX?
  'M',     // All-Star "M" series
  'TU',    // Top Hits Tunes?
  'ZMP',   // Zoom Karaoke
]);

// "Last, First" shape. Conservative: comma followed by a space, looks like a
// name (no other commas, no parens). Also used by scripts/measure-parse-coverage.js
// so the parser and the measurement agree on what "inverted" means.
export function isPersonNameShaped(s) {
  if (!s) return false;
  return /^[A-Z][A-Za-z'.\- ]+,\s+[A-Z][A-Za-z'.\- ]+$/.test(s);
}

function normalizeName(s) {
  if (!isPersonNameShaped(s)) return s;
  // "Last, First" → "First Last".
  const [last, first] = s.split(/,\s+/);
  return `${first} ${last}`;
}

export function parseFilename(basename) {
  const original = basename.trim();
  let s = original;

  // ---- Pre-pass: underscore separators (spec §1c) ----
  // "_Asleep_At_The_Wheel_-_Blues_For_Dixie" and underscores inside fields.
  // Translate _ → space up front so every later pass sees normal spacing.
  if (s.includes('_')) {
    s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- Pre-pass: rejoin disc codes fragmented by spaces (spec §1b) ----
  // Each rule needs real content after the code (the lookahead), so code-only
  // files ("CBEP 454-1-06") keep failing cleanly instead of back-tracking
  // into a garbage parse. "Blink 182"-style artist names match none of these
  // (plain digits with no code shape around them).
  const codeRejoins = [
    // "SC 8385-15 - …" → "SC8385-15 - …" (stray space before dashed digits;
    // the body may carry a stray letter, "8191r-02")
    [/^([A-Za-z]+) (\d[A-Za-z0-9]*(?:-\d+)+)(?= - )/, '$1$2'],
    // "sc 8795-03-howard…" → "sc8795-03-…" (tight-dash body after the code)
    [/^([A-Za-z]+) (\d+(?:-\d+)+)(?=-[A-Za-z])/, '$1$2'],
    // "CB6084 09 - …" / "CB5102 02-11 - …" → "CB6084-09 - …" (space where a
    // dash belongs, usually left by the underscore translation above)
    [/^([A-Za-z]+\d+) (\d+(?:-\d+)*)(?= - )/, '$1-$2'],
    // "sc 8119 - 02 - Artist - Title" → "sc8119-02 - Artist - Title";
    // needs TWO more segments so a plain "Artist - Title" tail can't be eaten
    [/^([A-Za-z]+) (\d+) - (\d+)(?= - .+ - )/, '$1$2-$3'],
    // "sc8155-09 elvis presley-cant help…" → "sc8155-09-elvis presley-…"
    // (complete code glued to the content by a bare space; prefix may carry
    // its own dash, "SC-8807-01"). Tight-join so the greedy pass can't
    // re-split the code; the non-greedy fallback parses it.
    [/^([A-Za-z]+-?\d+(?:-\d+)+)\s+(?=[A-Za-z])/, '$1-'],
  ];
  let gluedCode = false;
  for (const [pattern, replacement] of codeRejoins) {
    if (pattern.test(s)) {
      gluedCode = pattern === codeRejoins[codeRejoins.length - 1][0];
      s = s.replace(pattern, replacement);
      break;
    }
  }

  // ---- Pre-pass: bare leading track number ("01  Girl Happy - Elvis Presley",
  // "07 - Elvis - I Gotta Know") — rip-tool output with no disc code. Strip the
  // track token; the remainder carries no artist-order signal, so flag it and
  // let buildIndex's library-frequency check settle the order (beets-style).
  // ponytail: only 00-19 with a separator counts as a track — "98 Degrees",
  // "50 Cent", "10cc" never match; a real "21 …" track stays broken → overrides.
  let orderSuspect = false;
  const bareTrack = s.match(/^[01]\d[ .-]+\s*(\S.*)$/);
  if (bareTrack) {
    s = bareTrack[1];
    orderSuspect = s.includes(' - ');
  }

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
    let [, disc, middle, last] = startMatch;
    // "SC7534 - 01 - BJ Thomas - Raindrops…": the greedy split leaves the
    // track token glued to the artist. Fold it into the disc code instead.
    let trackGlue = middle.trim().match(/^(\d{1,2}) - (\S.*)$/);
    // Space-glued variant ("sc8190 - 01 turtles - …") only when the disc code
    // carries no track yet AND the digits are 00-19 — so "4 Seasons",
    // "20 Fingers", "12 Stones"-style artists after a full code never match.
    if (!trackGlue && !/-\d+$/.test(disc.trim())) {
      trackGlue = middle.trim().match(/^([01]\d) (\S.*)$/);
    }
    if (trackGlue) {
      disc = `${disc.trim()}-${trackGlue[1]}`;
      middle = trackGlue[2];
    }
    // Pure-digit middle ("Cb9076-02 - You're The Best Thing…") means the
    // backtracking split mistook the track for the artist. Fold it into the
    // disc code; re-split the tail if it still has a dash, else it's the
    // glued-blob class — no artist to extract, fail clean and keep the code.
    if (/^\d{1,2}$/.test(middle.trim())) {
      const foldedDisc = `${disc.trim()}-${middle.trim()}`;
      // tail with its own dash ("Elvis- Here Come Santa Claus") still splits;
      // a dashless tail is the glued-blob class — no artist to extract.
      const tailSplit = last.trim().match(/^(.+?)\s*-\s*(.+)$/);
      if (tailSplit) {
        return {
          artist: normalizeName(tailSplit[1].trim()),
          title: tailSplit[2].trim(),
          discCode: foldedDisc,
        };
      }
      return { artist: '', title: last.trim(), discCode: foldedDisc };
    }
    // Find the alphabetic prefix (the letters before the first digit) to look
    // up in our title-first table.
    const prefix = (disc.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    const middleSegment = middle.trim();
    const lastSegment = last.trim();
    // ponytail: comma-shape heuristic; per-disc override table only if
    // post-fix spot-check still shows a specific disc inverted (3-line patch then)
    const middleIsName = isPersonNameShaped(middleSegment);
    const lastIsName = isPersonNameShaped(lastSegment);
    let isTitleFirst = TITLE_FIRST_PREFIXES.has(prefix);
    // Mixed-order packs (the title-first list) get the comma-shape override:
    // exactly one "Last, First" segment → that one is the artist. Scoped to
    // those packs only — clean packs have ~1,100 comma-shaped TITLES
    // ("Walk, The") that misfire if the rule runs globally (measured 2026-07-10).
    if (isTitleFirst && middleIsName !== lastIsName) {
      isTitleFirst = lastIsName;
    }
    return {
      artist: normalizeName(isTitleFirst ? lastSegment : middleSegment),
      title: isTitleFirst ? middleSegment : lastSegment,
      discCode: disc.trim(),
      // Glued or track-folded files came from rip tools with no order
      // convention — let buildIndex's frequency check double-check the order.
      orderSuspect: orderSuspect || gluedCode || !!trackGlue,
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
        // Only set for stripped-track files: "01  Girl Happy - Elvis Presley"
        // could be either order; buildIndex resolves it by library frequency.
        orderSuspect,
      };
    }
  }

  // ---- Pass 4: fallback — give up, dump the ORIGINAL name as title ----
  // (not the pre-normalized one, so failed files stay searchable as-is)
  return {
    artist: '',
    title: original,
    discCode: '',
  };
}

// ---- songKey grouping (spec §2, ADR 0001) ----
// Per-file IDs stay the identity; songKey is the derived field that groups
// versions of the same song ("Dreams" on SC8199 and DK067 share one key).

/**
 * Normalize one field (artist or title) for grouping.
 * Order matters: "The"-folding runs before punctuation stripping because the
 * trailing form (", The") needs the comma to still be there.
 */
export function normalizeSongField(field) {
  return field
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the /, '')
    .replace(/, the$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive the grouping key and version label for a parsed song.
 * A trailing "(…)" on the title is treated as a version marker ("Radio
 * Version", "Duet"): stripped from the key, kept as versionLabel.
 * Returns { songKey, versionLabel }.
 */
// ponytail: no fuzzy matching — add when a real ungrouped duplicate is reported
export function makeSongKey(artist, title) {
  let baseTitle = title;
  let versionLabel = '';
  const parensSuffix = title.match(/^(.*\S)\s*\(([^)]+)\)$/);
  if (parensSuffix) {
    baseTitle = parensSuffix[1];
    versionLabel = parensSuffix[2].trim();
  }
  return {
    songKey: `${normalizeSongField(artist)}|${normalizeSongField(baseTitle)}`,
    versionLabel,
  };
}

/**
 * Group loaded songs into one entry per song, collapsing duplicate versions.
 *
 * The drive has whole folders copied around, so ~1/3 of entries are extra
 * copies of the same song on different discs. We group by songKey (spec §2)
 * so "Dreams" on SC8199 and DK067 become one result with two versions.
 *
 * Blank-artist files are the exception: their songKey is "|<title>", so
 * unrelated songs that merely share a title (both parsed to empty artist)
 * would collapse. Those key on filename instead — same guard the pre-#14
 * dedupe used.
 *
 * Each group carries display fields from its lowest-disc-code version — an
 * arbitrary-but-stable representative (not a quality pick; same honesty as
 * the old dedupe's "picks an arbitrary version") — and a `versions` array
 * (every file's id/discCode/label/filename), sorted by discCode for stable
 * display.
 *
 * Returns an array of groups:
 *   { id, artist, title, discCode, versions: [{ id, artist, title,
 *     discCode, versionLabel, filename }] }
 */
export function groupSongs(songs) {
  const groups = new Map();

  for (const song of songs) {
    const hasArtist = song.artist && song.artist.trim();
    const key = hasArtist ? song.songKey : `filename|${song.filename.toLowerCase()}`;

    const version = {
      id: song.id,
      artist: song.artist,
      title: song.title,
      discCode: song.discCode,
      versionLabel: song.versionLabel,
      filename: song.filename,
    };

    const existing = groups.get(key);
    if (existing) {
      existing.versions.push(version);
    } else {
      // Hold the first-seen artist/title as the group's display identity;
      // id/discCode get finalized from the canonical version after sorting.
      groups.set(key, { artist: song.artist, title: song.title, versions: [version] });
    }
  }

  return [...groups.values()].map(group => {
    group.versions.sort((a, b) => (a.discCode || '').localeCompare(b.discCode || ''));
    const canonical = group.versions[0];
    return {
      id: canonical.id,
      artist: group.artist,
      title: group.title,
      discCode: canonical.discCode,
      versions: group.versions,
    };
  });
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
export function buildIndex(filePaths) {
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
    // macOS AppleDouble sidecars ("._Song.mp3") are resource-fork junk that
    // pairs up like real songs — the real file sits beside them. Skip.
    if (base.startsWith('._')) continue;
    const key = `${dir.toLowerCase()}|${base}`;
    if (ext === '.mp3') mp3Map.set(key, filePath);
    else cdgMap.set(key, filePath);
  }

  const songs = [];
  const suspects = []; // stripped-track parses with ambiguous artist order
  for (const [key, mp3Path] of mp3Map) {
    const cdgPath = cdgMap.get(key);
    if (!cdgPath) continue; // skip audio-only orphans for v0
    const basename = path.basename(mp3Path, path.extname(mp3Path));
    const { artist, title, discCode, orderSuspect } = parseFilename(basename);
    const { songKey, versionLabel } = makeSongKey(artist, title);
    const song = {
      id: makeId(mp3Path),
      mp3Path,
      cdgPath,
      filename: basename,
      artist,
      title,
      discCode,
      songKey,
      versionLabel,
    };
    songs.push(song);
    if (orderSuspect) suspects.push(song);
  }

  // ---- artist-order fix for stripped-track files (beets-style) ----
  // "01  Girl Happy - Elvis Presley" parses as artist "Girl Happy"; the only
  // reliable signal is the rest of the library. If the TITLE side is a known
  // artist elsewhere and the artist side never is, the file is inverted: swap.
  // ponytail: threshold 3, no fuzzy match — one-off artists stay inverted and
  // go to overrides.json like every other tie.
  if (suspects.length > 0) {
    const artistCounts = new Map();
    const suspectSet = new Set(suspects);
    for (const song of songs) {
      if (suspectSet.has(song) || !song.artist) continue;
      const k = song.artist.toLowerCase();
      artistCounts.set(k, (artistCounts.get(k) || 0) + 1);
    }
    for (const song of suspects) {
      const titleKnown = (artistCounts.get(song.title.toLowerCase()) || 0) >= 3;
      const artistKnown = artistCounts.has(song.artist.toLowerCase());
      if (titleKnown && !artistKnown) {
        [song.artist, song.title] = [song.title, song.artist];
        const { songKey, versionLabel } = makeSongKey(song.artist, song.title);
        song.songKey = songKey;
        song.versionLabel = versionLabel;
      }
    }
  }

  return songs;
}

// ---- manual overrides (spec §3) ----
// overrides.json at the app root: file id (or filename) → { artist, title }.
// Applied in memory on every load — cached or fresh — so corrections take
// effect on restart without a rescan, and a rescan can never wipe them.
// This is the mechanism issue #8's manual rescue feeds.

const OVERRIDES_FILE = path.join(process.cwd(), 'overrides.json');

/**
 * Load the overrides map. Missing file → empty map (the normal case until
 * issue #8 lands corrections). Malformed file → warn loudly, empty map.
 */
export async function loadOverrides(filePath = OVERRIDES_FILE) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`Could not read overrides file ${filePath}`, { error: err.message });
    }
    return {}; // no overrides file — clean no-op
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    logger.warn(`Ignoring overrides file ${filePath}: expected a JSON object map, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
  } catch (err) {
    logger.warn(`Ignoring overrides file ${filePath}: invalid JSON`, { error: err.message });
  }
  return {};
}

/**
 * Apply manual corrections in place: matched songs get the override's
 * artist/title and a recomputed songKey/versionLabel, so they group under
 * the corrected identity. Matches by file id first, then filename.
 */
export function applyOverrides(songs, overrides) {
  let appliedCount = 0;
  for (const song of songs) {
    const override = overrides[song.id] || overrides[song.filename];
    if (!override) continue;
    // overrides.json is hand-edited (system boundary): a half-written entry
    // must not crash the scan, so skip anything without both string fields.
    if (typeof override.artist !== 'string' || typeof override.title !== 'string') {
      logger.warn(`Skipping malformed override for "${song.filename}": needs string artist and title`, { override });
      continue;
    }
    song.artist = override.artist;
    song.title = override.title;
    const { songKey, versionLabel } = makeSongKey(song.artist, song.title);
    song.songKey = songKey;
    song.versionLabel = versionLabel;
    appliedCount++;
  }
  if (appliedCount > 0) logger.info(`Applied ${appliedCount} manual overrides from overrides.json`);
  return songs;
}

// Bump whenever the parser or song schema changes: a version mismatch on load
// forces a full rescan, so parser upgrades self-apply on next start (spec §4).
export const CACHE_VERSION = 3;

/**
 * A cache payload is usable only if it was built by the current schema.
 * Unversioned (v1) caches fail this and trigger a rescan.
 */
export function isCacheCurrent(parsed) {
  return Boolean(parsed) && parsed.version === CACHE_VERSION && Array.isArray(parsed.songs);
}

/**
 * Try to load a previously-built index from disk.
 * Returns null if cache is missing, unreadable, or from an older schema.
 */
async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (isCacheCurrent(parsed)) return parsed;
    if (parsed && parsed.version !== CACHE_VERSION) {
      logger.info(`Cache is schema v${parsed.version ?? 1}, current is v${CACHE_VERSION} — rescanning.`);
    }
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
 * Rescan triggers: FORCE_RESCAN=1, a --rescan argument (what `npm run rescan`
 * uses — npm scripts run under cmd.exe on Windows, where the VAR=1 prefix
 * doesn't work), or a cache older than CACHE_VERSION.
 */
export async function loadLibrary() {
  const forceRescan = process.env.FORCE_RESCAN === '1' || process.argv.includes('--rescan');

  const overrides = await loadOverrides();

  if (!forceRescan) {
    const cached = await loadCache();
    if (cached) {
      logger.info(`Loaded ${cached.songs.length} songs from cache (${CACHE_FILE})`);
      logger.info(`Run "npm run rescan" (or set FORCE_RESCAN=1) to rebuild the cache.`);
      return applyOverrides(cached.songs, overrides);
    }
  }

  logger.info(`Scanning ${LIBRARY_ROOT} for the first time — this can take a minute or two on USB.`);
  const start = Date.now();

  const allFiles = await walk(LIBRARY_ROOT);
  logger.info(`Walked ${allFiles.length} files in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  const songs = buildIndex(allFiles);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`Indexed ${songs.length} paired songs in ${elapsed}s`);

  // Cache the raw parse; overrides stay a live layer on top so editing
  // overrides.json never requires a rescan to take effect.
  await saveCache({ version: CACHE_VERSION, generatedAt: new Date().toISOString(), root: LIBRARY_ROOT, songs });
  logger.info(`Cache written to ${CACHE_FILE}`);

  return applyOverrides(songs, overrides);
}
