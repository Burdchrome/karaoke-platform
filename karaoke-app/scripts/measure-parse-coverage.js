// Parse-coverage measurement (ticket #3, landed by ticket #9).
//
// Reads library-cache.json and reports the numbers every pipeline ticket
// proves itself against (spec §5):
//   - artist-present % / full-parse % / hard-failure count
//   - hard failures clustered into the ticket-#3 buckets, with samples
//   - suspected artist/title inversions: person-name-shaped titles among
//     the TITLE_FIRST_PREFIXES packs, per prefix
//
// Usage: node scripts/measure-parse-coverage.js [path-to-cache]
//        (defaults to ./library-cache.json — run from karaoke-app/)
//
// Read-only: never touches the cache or the drive.
//
// CANONICAL BASELINE (this script, 2026-07-10 cache, 65,832 songs):
//   98.7% artist-present · 875 hard failures · 512 suspected inversions
//   (DKM 326, ZMP 108, TU 74). Ticket #3's scratchpad reported ~450+ with a
//   slightly different (lost) regex; per-bucket failure counts were also
//   re-derived here (total still 875). Later tickets measure against THESE
//   numbers, not the #3 comment.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// Shared with the parser (ticket #10) so the measurement and parseFilename
// agree on what "title-first pack" and "inverted" mean.
import { TITLE_FIRST_PREFIXES, isPersonNameShaped } from '../server/library.js';

export { isPersonNameShaped };

const SAMPLES_PER_BUCKET = 5;

/**
 * Sort a hard-failure filename (empty artist after parsing) into one of the
 * ticket-#3 buckets. Order matters: each check assumes the earlier ones missed.
 */
export function classifyFailure(filename) {
  const s = filename.trim();

  // Stray-space disc code: "Ah 8012-01 …", "CBEP 454-1-06" — letters, a space,
  // then a digit group containing a dash (the code shape; a plain "Blink 182"
  // style name doesn't have the dashed digits).
  if (/^[A-Za-z]+ \d+(?:-\d+)+/.test(s)) return 'stray-space';

  // trackNN / numeric-only names: "11", "Track 07".
  if (/^track\s*\d+$/i.test(s) || /^[\d\s.]+$/.test(s)) return 'numeric-only';

  // No dash at all — nothing to split on, whatever else is in the name.
  if (!s.includes('-')) return 'no-separator';

  // Underscore used as the separator around a dash: "Aerosmith_-_Pink_-_…".
  if (s.includes('_-_')) return 'underscore';

  // Spaced dash present but parse still failed → pass-3 caution branch
  // (digits in the left side made the parser bail).
  if (/\s-\s/.test(s)) return 'digits-in-left';

  // Dashes only in tight "A-B" form.
  return 'tight-dash';
}

const BUCKET_LABELS = {
  'stray-space': 'stray-space disc code (e.g. "SC 8385-15 …")',
  'numeric-only': 'trackNN / numeric-only name',
  'no-separator': 'no separator at all',
  underscore: 'underscore-separated',
  'digits-in-left': 'digits-in-left-side (pass-3 caution branch)',
  'tight-dash': 'tight-dash only (e.g. "A-B", no spaced dash)',
};

/** Alphabetic prefix of a disc code ("DKM2014-02" → "DKM"). */
export function discPrefix(discCode) {
  if (!discCode) return '';
  return (discCode.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
}

/** First few distinct entries — duplicate files across dirs would drown samples. */
function sampleOf(names) {
  return [...new Set(names)].slice(0, SAMPLES_PER_BUCKET);
}

function percent(part, whole) {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

export async function measure(cachePath) {
  const cacheJson = await fs.readFile(cachePath, 'utf8');
  const cache = JSON.parse(cacheJson);
  if (!Array.isArray(cache.songs)) {
    throw new Error(`${cachePath} has no songs[] array — not a library cache?`);
  }
  const songs = cache.songs;

  // --- Coverage totals ---
  const fullParse = songs.filter((s) => s.artist && s.discCode);
  const artistNoDisc = songs.filter((s) => s.artist && !s.discCode);
  const failures = songs.filter((s) => !s.artist);

  // --- Failure buckets ---
  const buckets = new Map(Object.keys(BUCKET_LABELS).map((k) => [k, []]));
  for (const song of failures) {
    buckets.get(classifyFailure(song.filename)).push(song.filename);
  }

  // --- Suspected inversions in title-first packs ---
  const perPrefix = new Map(
    [...TITLE_FIRST_PREFIXES].map((p) => [p, { songs: 0, inverted: 0, samples: [] }])
  );
  for (const song of songs) {
    const stats = perPrefix.get(discPrefix(song.discCode));
    if (!stats) continue;
    stats.songs += 1;
    if (isPersonNameShaped(song.title)) {
      stats.inverted += 1;
      stats.samples.push(song.filename);
    }
  }

  return { total: songs.length, fullParse, artistNoDisc, failures, buckets, perPrefix };
}

function report({ total, fullParse, artistNoDisc, failures, buckets, perPrefix }) {
  const artistPresent = fullParse.length + artistNoDisc.length;
  const lines = [];

  lines.push('=== Parse coverage ===');
  lines.push(`Total songs:              ${total}`);
  lines.push(`Full parse (artist+disc): ${fullParse.length} (${percent(fullParse.length, total)})`);
  lines.push(`Artist, no disc code:     ${artistNoDisc.length} (${percent(artistNoDisc.length, total)})`);
  lines.push(`Artist present:           ${artistPresent} (${percent(artistPresent, total)})`);
  lines.push(`Hard failures (no artist): ${failures.length} (${percent(failures.length, total)})`);

  lines.push('');
  lines.push('=== Hard failures by bucket ===');
  for (const [key, names] of buckets) {
    lines.push(`\n${BUCKET_LABELS[key]}: ${names.length}`);
    for (const name of sampleOf(names)) lines.push(`  ${name}`);
  }

  lines.push('');
  lines.push('=== Suspected inversions (person-name-shaped titles, title-first packs) ===');
  lines.push('prefix  songs  inverted-looking');
  let totalInverted = 0;
  for (const [prefix, stats] of perPrefix) {
    totalInverted += stats.inverted;
    lines.push(
      `${prefix.padEnd(7)} ${String(stats.songs).padStart(5)}  ${String(stats.inverted).padStart(5)} (${percent(stats.inverted, stats.songs)})`
    );
  }
  lines.push(`Total suspected inversions: ${totalInverted}`);
  const sampled = sampleOf([...perPrefix.values()].flatMap((s) => s.samples));
  if (sampled.length > 0) {
    lines.push('Samples:');
    for (const name of sampled) lines.push(`  ${name}`);
  }

  return lines.join('\n');
}

async function main() {
  const cachePath = path.resolve(process.argv[2] || 'library-cache.json');
  try {
    const results = await measure(cachePath);
    console.log(`Measuring ${cachePath}\n`);
    console.log(report(results));
  } catch (err) {
    console.error(`Measurement failed for ${cachePath}: ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
