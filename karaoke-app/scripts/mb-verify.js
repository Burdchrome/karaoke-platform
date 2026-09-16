// mb-verify.js — deterministic MusicBrainz verify pass over the stage-1
// proposal tiers (docs/research/llm-assisted-stage1-triage.md, stages 1–2).
//
// For every record in the likely / review / unmatched tiers of
// .cache/stage1-proposals.json, this asks MusicBrainz "which artists actually
// have a recording with this title?" and cross-checks the answers against the
// file's own evidence (filename tokens, non-brand card artist). Verdicts:
//
//   confirmed — MB knows the proposed artist/title pairing, and no rival
//               artist is better supported by the file's own evidence
//   corrected — the proposal fails but exactly one MB artist IS supported by
//               the filename/card (the Alyssa-Reid-vs-Gilbert-O'Sullivan case)
//   resolved  — an unmatched record (no proposal) where exactly one MB artist
//               matches the file's evidence
//   flagged   — MusicBrainz has no recording with this title, or the lookup
//               failed twice: straight to the human queue
//   ambiguous — everything in between; the future LLM-judge pile
//
// Read-only over the library and overrides.json — writes only its report
// (.cache/mb-verify.json) and its lookup cache (.cache/mb-cache.json).
// Promotion into overrides.json stays Josh's manual gate, unchanged.
//
// Usage (from karaoke-app/, needs network):
//   node scripts/mb-verify.js [--proposals .cache/stage1-proposals.json]
//                             [--out .cache/mb-verify.json] [--cache .cache/mb-cache.json]
// MB_ENDPOINT env var overrides the MusicBrainz base URL (test seam).
//
// Definition of done: every input record lands in exactly one verdict bucket;
// summary printed; unit tests (mb-verify.test.js) cover the verdict logic
// offline; `npm run check` green.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  tokens, containsAllTokens, stripFeatClause, tokenSetSimilarity, jaroWinkler,
} from './fuzzy-match.js';

export const TITLE_MATCH_THRESHOLD = 0.85; // token-set, research doc §architecture
export const ARTIST_MATCH_THRESHOLD = 0.9; // Jaro-Winkler, same source

// Duplicated from cdg-harvest.js (which isn't import-safe — its top level runs
// the pipeline): card "artist" lines that are really the label's brand.
const LABEL_BRANDS = new Set([
  'sunfly', 'sound choice', 'chartbuster', 'music maestro', 'top tunes',
  'sbi', 'zoom', 'dk', 'karaoke', 'legends',
]);

// Cards carry decoration ("...(Am)", trailing ellipsis) that would pollute the
// MB phrase query; strip it but keep the words themselves raw for search.
export function searchTitleFor(record) {
  const rawTitle = record.cardTitle ?? record.proposal?.title ?? '';
  return String(rawTitle).replace(/\s*\([^)]*\)\s*$/, '').replace(/\.{2,}\s*$/, '').trim();
}

// Flatten an MB search response into comparable candidates: one entry per
// artist-credit whose recording title actually matches what we searched for.
export function extractCandidates(mbResponse, searchTitle) {
  const seenArtists = new Map(); // normalized base artist → best candidate
  for (const recording of mbResponse?.recordings ?? []) {
    const titleSimilarity = tokenSetSimilarity(searchTitle, recording.title ?? '');
    if (titleSimilarity < TITLE_MATCH_THRESHOLD) continue;
    const artist = (recording['artist-credit'] ?? [])
      .map((credit) => `${credit.name ?? ''}${credit.joinphrase ?? ''}`).join('').trim();
    if (!artist) continue;
    const key = stripFeatClause(artist).toLowerCase();
    const existing = seenArtists.get(key);
    if (!existing || (recording.score ?? 0) > existing.score) {
      seenArtists.set(key, {
        artist, title: recording.title, score: recording.score ?? 0, titleSimilarity,
      });
    }
  }
  return [...seenArtists.values()].sort((a, b) => b.score - a.score);
}

export const sameArtist = (a, b) =>
  jaroWinkler(stripFeatClause(a), stripFeatClause(b)) >= ARTIST_MATCH_THRESHOLD;

// The core verdict. record = { filename, cardTitle, cardArtist, proposal };
// mbCandidates = extractCandidates() output (empty array = MB has nothing).
export function judgeRecord(record, mbCandidates) {
  const filenameTokens = tokens(record.filename);
  const cardArtist =
    record.cardArtist && !LABEL_BRANDS.has(String(record.cardArtist).toLowerCase().trim())
      ? record.cardArtist : null;

  // "The file's own evidence supports this artist": their tokens appear in the
  // filename, or the card names them outright.
  const isEvidenceBacked = (artist) =>
    containsAllTokens(filenameTokens, tokens(stripFeatClause(artist))) ||
    (cardArtist !== null && sameArtist(cardArtist, artist));

  const backedCandidates = mbCandidates.filter((candidate) => isEvidenceBacked(candidate.artist));
  const evidenceOf = (candidate) => `${candidate.artist} — ${candidate.title} (MB score ${candidate.score})`;
  const topEvidence = mbCandidates.slice(0, 3).map(evidenceOf);

  if (record.proposal) {
    const proposalInMb = mbCandidates.find((c) => sameArtist(c.artist, record.proposal.artist));
    const rivals = backedCandidates.filter((c) => !sameArtist(c.artist, record.proposal.artist));

    if (proposalInMb && (isEvidenceBacked(record.proposal.artist) || rivals.length === 0)) {
      return {
        verdict: 'confirmed',
        confirmedBy: isEvidenceBacked(record.proposal.artist) ? 'musicbrainz+file-evidence' : 'musicbrainz',
        mbEvidence: [evidenceOf(proposalInMb)],
      };
    }
    if (!proposalInMb && rivals.length === 1) {
      return {
        verdict: 'corrected',
        suggestion: { artist: rivals[0].artist, title: rivals[0].title },
        confirmedBy: 'musicbrainz+file-evidence',
        mbEvidence: [evidenceOf(rivals[0])],
      };
    }
    if (!mbCandidates.length) return { verdict: 'flagged', reason: 'no MusicBrainz recording matches the title' };
    return { verdict: 'ambiguous', mbEvidence: topEvidence };
  }

  // No proposal (the unmatched tier): can MB + the file's evidence name one artist?
  if (backedCandidates.length === 1) {
    return {
      verdict: 'resolved',
      suggestion: { artist: backedCandidates[0].artist, title: backedCandidates[0].title },
      confirmedBy: 'musicbrainz+file-evidence',
      mbEvidence: [evidenceOf(backedCandidates[0])],
    };
  }
  if (!mbCandidates.length) return { verdict: 'flagged', reason: 'no MusicBrainz recording matches the title' };
  return { verdict: 'ambiguous', mbEvidence: topEvidence };
}

// ---------------------------------------------------------------------------
// Everything below is I/O: MB requests (paced + cached) and the report.

// Override lets the e2e suite (triage-pipeline.e2e.test.js) point this at an
// in-test mock server instead of the real MusicBrainz API.
const MB_ENDPOINT = process.env.MB_ENDPOINT ?? 'https://musicbrainz.org/ws/2/recording';
// MB policy wants an identifiable client; the repo URL is the contact point.
const USER_AGENT = 'karaoke-app-mb-verify/1.0 (https://github.com/Burdchrome/karaoke-platform)';
// 1.1s tripped steady 503s in the 2026-09-16 run; 2s clears MB's limiter.
// Overridable so the e2e suite (a mock server, no real rate limit) doesn't
// have to sleep between every request.
const REQUEST_GAP_MS = Number(process.env.MB_REQUEST_GAP_MS ?? 2000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchMbRecordings(luceneQuery) {
  const url = `${MB_ENDPOINT}?query=${encodeURIComponent(luceneQuery)}&fmt=json&limit=15`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (response.status === 503) throw new Error('503 rate-limited');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn(`MB lookup failed for ${luceneQuery} (attempt ${attempt}): ${err.message}`);
      if (attempt === 2) return null;
      await sleep(3000);
    }
  }
  return null;
}

// Cached wrapper: one MB request per distinct query per run history.
async function cachedLookup(mbCache, luceneQuery) {
  const cacheKey = luceneQuery.toLowerCase();
  if (!(cacheKey in mbCache)) {
    const result = await fetchMbRecordings(luceneQuery);
    await sleep(REQUEST_GAP_MS);
    if (result === null) return null; // failures are never cached (retried next run)
    mbCache[cacheKey] = result;
  }
  return mbCache[cacheKey];
}

// Title-only search first; if the proposed artist isn't among the hits, run a
// second, artist-scoped query — popular titles bury the right artist under 15
// covers ("We Are Young" returned none of fun.'s recordings). Returns null
// only when a needed lookup failed.
export async function lookupCandidates(record, searchTitle, mbCache, lookup) {
  const escaped = searchTitle.replace(/"/g, '');
  const titleResponse = await lookup(mbCache, `recording:"${escaped}"`);
  if (titleResponse === null) return null;

  let recordings = titleResponse.recordings ?? [];
  const candidates = extractCandidates(titleResponse, searchTitle);
  if (record.proposal && !candidates.some((c) => sameArtist(c.artist, record.proposal.artist))) {
    const artistEscaped = String(record.proposal.artist).replace(/"/g, '');
    const scopedResponse = await lookup(mbCache, `artist:"${artistEscaped}" AND recording:"${escaped}"`);
    if (scopedResponse === null) return null;
    recordings = [...recordings, ...(scopedResponse.recordings ?? [])];
  }
  return extractCandidates({ recordings }, searchTitle);
}

function parseArgs(argv) {
  const args = {
    proposals: '.cache/stage1-proposals.json', out: '.cache/mb-verify.json', cache: '.cache/mb-cache.json',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--proposals') args.proposals = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--cache') args.cache = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const proposals = JSON.parse(fs.readFileSync(args.proposals, 'utf8'));

  const records = [];
  for (const tier of ['likely', 'review', 'unmatched']) {
    for (const [filename, entry] of Object.entries(proposals[tier] ?? {})) {
      records.push({ tier, filename, ...entry });
    }
  }
  console.log(`Verifying ${records.length} records against MusicBrainz (~${Math.ceil(records.length * REQUEST_GAP_MS / 60000)} min at 1 req/s)...`);

  const cachePath = args.cache;
  let mbCache = {};
  try {
    mbCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`MB cache unreadable, starting fresh: ${err.message}`);
  }
  // A cached null is a failed lookup, not an answer — retry it on rerun.
  // Pre-2026-09-16 caches keyed by bare title; re-key to the lucene form.
  for (const [key, value] of Object.entries(mbCache)) {
    if (value === null) {
      delete mbCache[key];
    } else if (!key.startsWith('recording:') && !key.startsWith('artist:')) {
      delete mbCache[key];
      mbCache[`recording:"${key.replace(/"/g, '')}"`] = value;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: args.proposals,
    thresholds: { title: TITLE_MATCH_THRESHOLD, artist: ARTIST_MATCH_THRESHOLD },
    confirmed: {}, corrected: {}, resolved: {}, ambiguous: {}, flagged: {},
  };

  let processed = 0;
  for (const record of records) {
    const searchTitle = searchTitleFor(record);
    let judgement;
    let candidates = null;
    if (!searchTitle) {
      judgement = { verdict: 'flagged', reason: 'no card or proposal title to search with' };
    } else {
      candidates = await lookupCandidates(record, searchTitle, mbCache, cachedLookup);
      judgement = candidates === null
        ? { verdict: 'flagged', reason: 'MusicBrainz lookup failed twice' }
        : judgeRecord(record, candidates);
    }

    const { verdict, ...detail } = judgement;
    report[verdict][record.filename] = {
      tier: record.tier,
      proposal: record.proposal,
      cardTitle: record.cardTitle ?? null,
      cardArtist: record.cardArtist ?? null,
      searchTitle,
      ...detail,
      // The LLM judge (llm-judge.js) needs the full candidate list, not the
      // human-facing top-3 evidence strings.
      ...(verdict === 'ambiguous' && candidates ? { candidates } : {}),
    };

    processed++;
    if (processed % 25 === 0) {
      console.log(`  ${processed}/${records.length}...`);
      fs.writeFileSync(cachePath, JSON.stringify(mbCache));
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(mbCache));
  report.summary = Object.fromEntries(
    ['confirmed', 'corrected', 'resolved', 'ambiguous', 'flagged'].map((verdict) => [
      verdict, Object.keys(report[verdict]).length,
    ])
  );
  fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log('Summary:', JSON.stringify(report.summary, null, 2));
  console.log(`Report written to ${args.out} — nothing touched overrides.json.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
