// cdg-harvest.js — turn Stage 1 title-card reads into override proposals (issue #21).
//
// Pipeline piece 4 (matcher). Takes the raw reads from cdg-read.js, matches each
// card title against the named library (partial-title matching included — Top
// Tunes cards truncate on screen), and stages tiered proposals for Josh's
// ratification. Read-only over the library; writes only its --out report.
// Promotion into overrides.json stays manual (the #21 boundary).
//
// Usage:
//   node scripts/cdg-harvest.js [--reads .cache/stage1-reads.json]
//                               [--out .cache/stage1-proposals.json]
//   node scripts/cdg-harvest.js --apply auto,likely   (Josh's gate: merge the
//       named tiers from the proposals file into overrides.json, then rescan)
//
// Tiers (per proposal):
//   auto    — one artist candidate, confirmed by the filename or the card itself
//   likely  — one artist candidate, nothing to cross-check it against
//   review  — several candidates, or a truncated-title match; needs Josh's eye
//   unmatched — no title card found, or the card matches nothing in the library

import fs from 'node:fs';
import { normalizeSongField } from '../server/library.js';

const LABEL_BRANDS = new Set([
  // Card "artist" lines that are really the label's brand, not a performer.
  'sunfly', 'sound choice', 'chartbuster', 'music maestro', 'top tunes',
  'sbi', 'zoom', 'dk', 'karaoke', 'legends',
]);

function parseArgs(argv) {
  const args = { reads: '.cache/stage1-reads.json', out: '.cache/stage1-proposals.json', apply: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reads') args.reads = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--apply') args.apply = argv[++i];
  }
  return args;
}

// The manual promotion gate: only runs when Josh names the tiers to accept.
// Existing overrides win on collision — a hand-written entry is already ratified.
function applyTiers(proposalsPath, tierList) {
  const proposals = JSON.parse(fs.readFileSync(proposalsPath, 'utf8'));
  const current = JSON.parse(fs.readFileSync('overrides.json', 'utf8'));
  let added = 0;
  for (const tier of tierList) {
    if (!proposals[tier]) { console.error(`No tier "${tier}" in ${proposalsPath}`); process.exit(1); }
    for (const [filename, entry] of Object.entries(proposals[tier])) {
      if (!entry.proposal || current[filename]) continue;
      current[filename] = entry.proposal;
      added++;
    }
  }
  fs.writeFileSync('overrides.json', JSON.stringify(current, null, 2) + '\n');
  console.log(`Merged ${added} proposal(s) from tier(s) [${tierList.join(', ')}] into overrides.json (${Object.keys(current).length} total).`);
  console.log('Run `npm run rescan` to rebuild the library with them.');
}

// Cards print "IN THE STYLE OF <artist>" and sometimes trailing key-change
// notes like "(Am)"; strip decoration before comparing against the library.
function normalizeCardTitle(rawTitle) {
  return normalizeSongField(
    String(rawTitle ?? '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\.{2,}\s*$/, '')
  );
}

// NOT normalizeSongField: that deletes punctuation in place, which welds
// dash-packed filenames ("03.-Matt-Cardle-Amazing") into one unmatchable token.
// Spacing it keeps both sides comparable ("10,000" → "10 000" on both).
const tokens = (text) =>
  String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Order-free subset: "Cassidy, Eva" on a card still confirms "Eva Cassidy".
function containsAllTokens(haystackTokens, needleTokens) {
  return needleTokens.length > 0 && needleTokens.every((t) => haystackTokens.includes(t));
}

const args = parseArgs(process.argv.slice(2));

if (args.apply) {
  applyTiers(args.out, args.apply.split(',').map((t) => t.trim()).filter(Boolean));
  process.exit(0);
}

const { results } = JSON.parse(fs.readFileSync(args.reads, 'utf8'));
const { songs } = JSON.parse(fs.readFileSync('library-cache.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('overrides.json', 'utf8'));

// The named library is the ground truth we match into: for every title, which
// artists perform it and how often (copy count doubles as a popularity prior).
const titleIndex = new Map(); // normTitle → Map(normArtist → {artist, title, count})
for (const song of songs) {
  if (!song.artist?.trim()) continue;
  const normTitle = normalizeSongField(song.title.replace(/\s*\([^)]*\)\s*$/, ''));
  if (!normTitle) continue;
  if (!titleIndex.has(normTitle)) titleIndex.set(normTitle, new Map());
  const byArtist = titleIndex.get(normTitle);
  const normArtist = normalizeSongField(song.artist);
  const entry = byArtist.get(normArtist) ?? { artist: song.artist, title: song.title, count: 0 };
  entry.count++;
  byArtist.set(normArtist, entry);
}
const allTitles = [...titleIndex.keys()];

// Overrides key on the library's exact filename — resolve reads case-insensitively
// and surface any read that no longer maps to a library file.
const libraryFilenames = new Map(songs.map((s) => [s.filename.toLowerCase(), s.filename]));

function matchRead(result) {
  const cardTitle = result.read?.title;
  if (!cardTitle) return { tier: 'unmatched', reason: 'no title card found' };

  const normCard = normalizeCardTitle(cardTitle);
  if (!normCard) return { tier: 'unmatched', reason: 'card title normalized to nothing' };

  // Exact title hit first; otherwise the card is a prefix of the real title
  // (screen truncation). Short prefixes match everything, so require length.
  let matchedTitles = titleIndex.has(normCard) ? [normCard] : [];
  let truncated = false;
  if (!matchedTitles.length && normCard.length >= 8) {
    matchedTitles = allTitles.filter((t) => t.startsWith(normCard));
    truncated = matchedTitles.length > 0;
  }
  // No named twin in the library — still hand Josh what the card says, so the
  // override can be written from the JSON without replaying the file.
  if (!matchedTitles.length) {
    return {
      tier: 'unmatched',
      reason: 'no library title matches the card',
      cardTitle,
      cardArtist: result.read.artist ?? null,
    };
  }

  const candidates = matchedTitles
    .flatMap((t) => [...titleIndex.get(t).values()])
    .sort((a, b) => b.count - a.count);

  // Cross-checks: the target's own filename usually still carries the artist,
  // and non-brand card artists ("IN THE STYLE OF ...") confirm directly.
  const filenameTokens = tokens(result.file);
  const cardArtist = result.read.artist && !LABEL_BRANDS.has(normalizeSongField(result.read.artist))
    ? result.read.artist : null;
  const confirmed = candidates.filter((c) =>
    containsAllTokens(filenameTokens, tokens(c.artist)) ||
    (cardArtist && normalizeSongField(cardArtist) === normalizeSongField(c.artist))
  );

  const pick = confirmed[0] ?? candidates[0];
  const tier =
    confirmed.length === 1 && !truncated ? 'auto'
    : candidates.length === 1 && !truncated ? 'likely'
    : 'review';

  return {
    tier,
    proposal: { artist: pick.artist, title: pick.title },
    cardTitle,
    cardArtist,
    truncated: truncated || undefined,
    confirmedBy: confirmed.length ? (confirmed.length === 1 ? 'filename/card' : 'multiple-confirmed') : undefined,
    otherCandidates: candidates.length > 1
      ? candidates.filter((c) => c !== pick).slice(0, 5).map((c) => `${c.artist} — ${c.title} (${c.count} copies)`)
      : undefined,
  };
}

const report = { generatedAt: new Date().toISOString(), auto: {}, likely: {}, review: {}, unmatched: {}, skipped: {} };

for (const result of results) {
  const libraryFilename = libraryFilenames.get(result.file.toLowerCase());
  if (!libraryFilename) {
    report.skipped[result.file] = 'read does not map to any library filename';
    continue;
  }
  if (overrides[libraryFilename]) {
    report.skipped[libraryFilename] = 'already in overrides.json';
    continue;
  }
  const match = matchRead(result);
  const { tier, ...detail } = match;
  report[tier][libraryFilename] = detail.proposal
    ? detail
    : { ...detail, framesRead: result.framesRead };
}

const counts = Object.fromEntries(
  ['auto', 'likely', 'review', 'unmatched', 'skipped'].map((tier) => [tier, Object.keys(report[tier]).length])
);
report.summary = { reads: results.length, ...counts };

fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
console.log('Summary:', JSON.stringify(report.summary, null, 2));
console.log(`Proposals written to ${args.out} — nothing touched overrides.json.`);
