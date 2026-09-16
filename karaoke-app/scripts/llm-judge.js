// llm-judge.js — stage 3 of the triage (docs/research/llm-assisted-stage1-triage.md):
// the local Qwen judge over mb-verify's ambiguous bucket, with receipt validation.
//
// The model never gets trusted directly. Its schema forces it to quote the
// evidence (filename artist/title, card title) BEFORE the verdict fields, and
// validateReceipts() then re-checks every quote and verdict against the actual
// record with plain string comparison — a verdict whose receipts don't hold is
// demoted to receipt_failed (human queue), whatever the model claimed.
//
// Verdict support rules (validateReceipts):
//   confirm — the proposed artist appears in the filename, matches a non-brand
//             card artist, or is among the MusicBrainz candidates
//   correct — the replacement artist must be BOTH MB-known and backed by the
//             file's own evidence (filename tokens / card artist); its title
//             must match the card or that artist's MB title
//   flag_for_human — always accepted; that's the safe direction
//
// Resume-safe: records already in the output file are skipped, so the run can
// proceed in foreground rounds (--limit N). Raw model responses append to
// .cache/llm-judge-log.jsonl for post-run spot checks without re-querying.
//
// Usage (from karaoke-app/, needs llama-server up on :8081):
//   node scripts/llm-judge.js [--limit N] [--report .cache/mb-verify.json]
//                             [--out .cache/llm-judge.json] [--log .cache/llm-judge-log.jsonl]
// JUDGE_URL env var overrides the llama-server base URL (test seam).
//
// Read-only over the library and overrides.json; promotion stays manual.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tokens, containsAllTokens, tokenSetSimilarity } from './fuzzy-match.js';
import { sameArtist } from './mb-verify.js';

// Override lets the e2e suite (triage-pipeline.e2e.test.js) point this at an
// in-test mock server instead of the real llama-server.
const SERVER_URL = process.env.JUDGE_URL ?? 'http://localhost:8081';
export const TITLE_MATCH_THRESHOLD = 0.85; // same bar as mb-verify

// Evidence-extraction fields come before the verdict fields on purpose:
// quote-then-judge ordering (research doc §judge design). Never reorder.
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    filename_artist: { type: 'string' },
    filename_title: { type: 'string' },
    cardtitle_evidence: { type: 'string' },
    proposal_artist: { type: 'string' },
    proposal_title: { type: 'string' },
    agreement: { enum: ['filename_and_card_agree', 'filename_and_card_conflict', 'card_missing_or_illegible'] },
    verdict: { enum: ['confirm', 'correct', 'flag_for_human'] },
    corrected_artist: { type: ['string', 'null'] },
    corrected_title: { type: ['string', 'null'] },
    confidence: { enum: ['high', 'medium', 'low'] },
    reasoning_note: { type: 'string' },
  },
  required: ['filename_artist', 'filename_title', 'cardtitle_evidence', 'proposal_artist',
    'proposal_title', 'agreement', 'verdict', 'corrected_artist', 'corrected_title',
    'confidence', 'reasoning_note'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You verify karaoke file metadata. The filename and the OCR'd card title are ground-truth evidence for THIS SPECIFIC FILE. Your job is to verify the machine's proposal against this file's own evidence, NOT to identify which version of the song is most famous. If the filename credits a different artist than the well-known version of a similar-titled song, trust the filename. The MusicBrainz results are an external catalog lookup — they may omit the correct artist; absence from the list is NOT evidence against the filename. If the filename carries no artist or title words (for example it is just a number), write "absent" for those fields instead of inventing a quote. Verdict semantics: "confirm" = the machine proposal already matches the file evidence as-is; "correct" = the proposal is wrong (or there is no proposal) and the file evidence supports a specific replacement, given in corrected_artist/corrected_title; "flag_for_human" = the evidence conflicts, is unreadable, or does not single out one artist. When there is no machine proposal, never "confirm": either the file's own evidence names exactly one candidate ("correct") or it does not ("flag_for_human").`;

export function buildMessages(record) {
  const candidateLines = (record.candidates ?? [])
    .map((c) => `${c.artist} — ${c.title} (MB score ${c.score})`);
  const user = [
    `filename: ${record.filename}`,
    `card_title (OCR from the CDG graphics): ${record.cardTitle ?? 'absent'}`,
    ...(record.cardArtist ? [`card_artist: ${record.cardArtist}`] : []),
    `machine_proposal: ${record.proposal ? `${record.proposal.artist} — ${record.proposal.title}` : 'none'}`,
    `musicbrainz_results: ${candidateLines.length ? candidateLines.join(' | ') : 'no matches'}`,
    '',
    'Extract the evidence verbatim, then give your verdict.',
  ].join('\n');
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }];
}

// Deterministic re-check of everything the model claimed. Returns a list of
// receipt failures — empty means the verdict stands on verified evidence.
export function validateReceipts(record, verdict) {
  const failures = [];
  const filenameTokens = tokens(record.filename);
  const isAbsentClaim = (text) => /^(absent|none|n\/a|illegible.*)$/i.test(String(text ?? '').trim());
  const isInFilename = (text) =>
    !isAbsentClaim(text) && containsAllTokens(filenameTokens, tokens(text));

  // The quoted evidence must actually be quotes, not inventions.
  for (const field of ['filename_artist', 'filename_title']) {
    if (!isAbsentClaim(verdict[field]) && !isInFilename(verdict[field])) {
      failures.push(`${field} "${verdict[field]}" does not appear in the filename`);
    }
  }
  if (record.cardTitle) {
    if (tokenSetSimilarity(verdict.cardtitle_evidence, record.cardTitle) < TITLE_MATCH_THRESHOLD) {
      failures.push(`cardtitle_evidence "${verdict.cardtitle_evidence}" does not match the card "${record.cardTitle}"`);
    }
  }

  const inMbCandidates = (artist) =>
    (record.candidates ?? []).some((c) => sameArtist(c.artist, artist));
  const matchesCardArtist = (artist) =>
    record.cardArtist != null && sameArtist(record.cardArtist, artist);

  if (verdict.verdict === 'confirm') {
    if (!record.proposal) {
      failures.push('confirm verdict on a record with no proposal');
    } else if (!isInFilename(record.proposal.artist) &&
        !matchesCardArtist(record.proposal.artist) &&
        !inMbCandidates(record.proposal.artist)) {
      failures.push(`confirmed artist "${record.proposal.artist}" is backed by no evidence source`);
    }
  }

  if (verdict.verdict === 'correct') {
    const { corrected_artist: artist, corrected_title: title } = verdict;
    if (!artist || !title) {
      failures.push('correct verdict without corrected_artist/corrected_title');
    } else {
      if (!inMbCandidates(artist)) failures.push(`corrected artist "${artist}" is not among the MusicBrainz candidates`);
      if (!isInFilename(artist) && !matchesCardArtist(artist)) {
        failures.push(`corrected artist "${artist}" has no backing in the file's own evidence`);
      }
      const mbTwin = (record.candidates ?? []).find((c) => sameArtist(c.artist, artist));
      const titleHolds =
        (record.cardTitle && tokenSetSimilarity(title, record.cardTitle) >= TITLE_MATCH_THRESHOLD) ||
        (mbTwin && tokenSetSimilarity(title, mbTwin.title) >= TITLE_MATCH_THRESHOLD);
      if (!titleHolds) failures.push(`corrected title "${title}" matches neither the card nor that artist's MB title`);
    }
  }

  return failures; // flag_for_human always passes — that's the safe direction
}

// ---------------------------------------------------------------------------

async function callJudge(messages) {
  const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: 0.2,
      max_tokens: 700,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema', json_schema: { name: 'triage_verdict', schema: JUDGE_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`judge server HTTP ${response.status}`);
  const body = await response.json();
  return body.choices?.[0]?.message?.content ?? '';
}

function parseArgs(argv) {
  const args = {
    report: '.cache/mb-verify.json', out: '.cache/llm-judge.json', limit: Infinity,
    log: '.cache/llm-judge-log.jsonl',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') args.report = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--log') args.log = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    await fetch(`${SERVER_URL}/v1/models`);
  } catch {
    console.error(`llama-server is not reachable on ${SERVER_URL} — bring Qwen up (swap-server.ps1) first.`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
  let output = { confirmed: {}, corrected: {}, flagged: {}, receipt_failed: {} };
  try {
    output = JSON.parse(fs.readFileSync(args.out, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Judge output unreadable, starting fresh: ${err.message}`);
  }
  const alreadyJudged = new Set(
    Object.values(output).flatMap((bucket) => Object.keys(bucket))
  );

  const pending = Object.entries(report.ambiguous ?? {})
    .filter(([filename]) => !alreadyJudged.has(filename))
    .slice(0, args.limit);
  console.log(`Judging ${pending.length} of ${Object.keys(report.ambiguous ?? {}).length} ambiguous records (${alreadyJudged.size} already done)...`);

  let processed = 0;
  for (const [filename, entry] of pending) {
    const record = { filename, ...entry };
    const startedAt = Date.now();
    let bucket;
    let detail;
    try {
      const raw = await callJudge(buildMessages(record));
      fs.appendFileSync(args.log, JSON.stringify({ filename, raw, ms: Date.now() - startedAt }) + '\n');
      const verdict = JSON.parse(raw); // schema-enforced, but never best-effort
      const receiptFailures = validateReceipts(record, verdict);
      if (receiptFailures.length) {
        bucket = 'receipt_failed';
        detail = { modelVerdict: verdict, receiptFailures };
      } else if (verdict.verdict === 'confirm') {
        bucket = 'confirmed';
        detail = { proposal: record.proposal, modelVerdict: verdict };
      } else if (verdict.verdict === 'correct') {
        bucket = 'corrected';
        detail = { suggestion: { artist: verdict.corrected_artist, title: verdict.corrected_title }, modelVerdict: verdict };
      } else {
        bucket = 'flagged';
        detail = { modelVerdict: verdict };
      }
    } catch (err) {
      console.warn(`Judge failed on "${filename}": ${err.message}`);
      bucket = 'receipt_failed';
      detail = { receiptFailures: [`judge call failed: ${err.message}`] };
    }

    output[bucket][filename] = { tier: entry.tier, cardTitle: entry.cardTitle ?? null, ...detail };
    processed++;
    if (processed % 5 === 0) {
      fs.writeFileSync(args.out, JSON.stringify(output, null, 2));
      console.log(`  ${processed}/${pending.length}...`);
    }
  }

  fs.writeFileSync(args.out, JSON.stringify(output, null, 2));
  const summary = Object.fromEntries(Object.keys(output).map((b) => [b, Object.keys(output[b]).length]));
  console.log('Judge summary (all rounds so far):', JSON.stringify(summary, null, 2));
  const remaining = Object.keys(report.ambiguous ?? {}).length - Object.values(summary).reduce((a, b) => a + b, 0);
  console.log(remaining > 0 ? `${remaining} records still pending — rerun to continue.` : 'All ambiguous records judged.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
