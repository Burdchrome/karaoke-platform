// triage-apply.js — the stage-1 triage promotion gate (issue #28, spec #27).
//
// Moves named, ratified verdict buckets from the triage reports into
// overrides.json — the manual crossing from "the pipeline thinks" to "the
// library says", made executable and logged. Mirrors cdg-harvest's --apply
// pattern: buckets are named explicitly, existing overrides win on collision,
// every run prints exactly what it added and skipped. Nothing is promoted by
// default; flagged/ambiguous/receipt-failed buckets are never promotable.
//
// Usage:
//   node scripts/triage-apply.js --apply confirmed,corrected
//   node scripts/triage-apply.js --sample confirmed [--n 10]
//   node scripts/triage-apply.js --queue [--card-audit .cache/card-audit-2026-09-17.json]
//       [--mb-report .cache/mb-verify.json] [--judge-report .cache/llm-judge.json]
//       [--overrides overrides.json]
//
// Three modes, mutually exclusive:
//   --apply   Promote named buckets into overrides (write). Confirmed buckets
//             promote the proposal; corrected/resolved promote the suggestion.
//   --sample  Deal N random records from any bucket with evidence (read-only).
//   --queue   List the human queue: flagged + judge-flagged + receipt-failed +
//             demoted records, with card-audit notes attached (read-only).
//
// Bucket names: bare = the mb-verify report (confirmed, corrected, resolved,
// ambiguous, flagged); judge: prefix = the LLM judge report. Only confirmed,
// corrected, resolved, judge:confirmed, judge:corrected are promotable.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROMOTABLE_BUCKETS = {
  confirmed: { report: 'mbReport', bucket: 'confirmed', field: 'proposal' },
  corrected: { report: 'mbReport', bucket: 'corrected', field: 'suggestion' },
  resolved: { report: 'mbReport', bucket: 'resolved', field: 'suggestion' },
  'judge:confirmed': { report: 'judgeReport', bucket: 'confirmed', field: 'proposal' },
  'judge:corrected': { report: 'judgeReport', bucket: 'corrected', field: 'suggestion' },
};

const VALID_BUCKET_NAMES = Object.keys(PROMOTABLE_BUCKETS);
const VIEW_BUCKETS = {
  confirmed: { report: 'mbReport', bucket: 'confirmed' },
  corrected: { report: 'mbReport', bucket: 'corrected' },
  resolved: { report: 'mbReport', bucket: 'resolved' },
  ambiguous: { report: 'mbReport', bucket: 'ambiguous' },
  flagged: { report: 'mbReport', bucket: 'flagged' },
  'judge:confirmed': { report: 'judgeReport', bucket: 'confirmed' },
  'judge:corrected': { report: 'judgeReport', bucket: 'corrected' },
  'judge:flagged': { report: 'judgeReport', bucket: 'flagged' },
  'judge:receipt_failed': { report: 'judgeReport', bucket: 'receipt_failed' },
};
const VALID_VIEW_BUCKET_NAMES = Object.keys(VIEW_BUCKETS);

function assertPromotableBuckets(bucketNames) {
  for (const bucketName of bucketNames) {
    if (!PROMOTABLE_BUCKETS[bucketName]) {
      throw new Error(`Bucket "${bucketName}" is not promotable. Valid bucket names: ${VALID_BUCKET_NAMES.join(', ')}`);
    }
  }
}

export function planApply(bucketNames, reports, currentOverrides) {
  assertPromotableBuckets(bucketNames);

  const adds = {};
  const skipped = [];

  for (const bucketName of bucketNames) {
    const { report, bucket, field } = PROMOTABLE_BUCKETS[bucketName];
    const records = reports[report]?.[bucket] ?? {};
    for (const [filename, record] of Object.entries(records)) {
      const promoted = record[field];
      if (!promoted?.artist || !promoted?.title) {
        skipped.push({ filename, bucket: bucketName, reason: `missing ${field} artist/title` });
      } else if (currentOverrides[filename]) {
        skipped.push({ filename, bucket: bucketName, reason: 'already exists in overrides.json' });
      } else if (adds[filename]) {
        skipped.push({ filename, bucket: bucketName, reason: 'already added from another bucket' });
      } else {
        adds[filename] = { artist: promoted.artist, title: promoted.title };
      }
    }
  }

  return { adds, skipped };
}

function resolveViewBucket(bucketName) {
  const bucket = VIEW_BUCKETS[bucketName];
  if (!bucket) {
    throw new Error(`Unknown bucket "${bucketName}". Valid bucket names: ${VALID_VIEW_BUCKET_NAMES.join(', ')}`);
  }
  return bucket;
}

export function sampleBucket(bucketName, reports, n) {
  const { report, bucket } = resolveViewBucket(bucketName);
  const entries = Object.entries(reports[report]?.[bucket] ?? {})
    .map(([filename, record]) => ({ filename, record }));
  if (n >= entries.length) return entries;

  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, n);
}

function auditObjectNote(entry) {
  if (typeof entry === 'string') return entry;
  if (entry?.resolution) return entry.resolution;
  if (entry?.cardTruth) return entry.cardTruth;
  if (entry?.text) return entry.text;
  return undefined;
}

function findAuditNote(filename, cardAudit) {
  if (!cardAudit) return undefined;
  for (const section of ['cardContradicts', 'cardSupports', 'convictionOverturned']) {
    const note = auditObjectNote(cardAudit[section]?.[filename]);
    if (note) return note;
  }

  const lowerFilename = filename.toLowerCase();
  for (const entry of cardAudit.cardSilent ?? []) {
    const base = String(entry).split(' (')[0].toLowerCase();
    if (lowerFilename.startsWith(base)) return entry;
  }
  return undefined;
}

function pushQueueEntries(queue, source, records, cardAudit) {
  for (const [filename, record] of Object.entries(records ?? {})) {
    const auditNote = findAuditNote(filename, cardAudit);
    queue.push({ source, filename, record, ...(auditNote ? { auditNote } : {}) });
  }
}

export function buildQueue({ mbReport, judgeReport }, cardAudit) {
  const queue = [];
  pushQueueEntries(queue, 'flagged', mbReport.flagged, cardAudit);
  pushQueueEntries(queue, 'judge:flagged', judgeReport.flagged, cardAudit);
  pushQueueEntries(queue, 'judge:receipt_failed', judgeReport.receipt_failed, cardAudit);
  pushQueueEntries(
    queue,
    'demoted',
    Object.fromEntries(Object.entries(mbReport.ambiguous ?? {}).filter(([, record]) => record.note)),
    cardAudit
  );
  return queue;
}

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    apply: '',
    sample: '',
    queue: false,
    n: 10,
    mbReport: '.cache/mb-verify.json',
    judgeReport: '.cache/llm-judge.json',
    overrides: 'overrides.json',
    cardAudit: '.cache/card-audit-2026-09-17.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = readFlagValue(argv, i++, flag);
    else if (flag === '--sample') args.sample = readFlagValue(argv, i++, flag);
    else if (flag === '--queue') args.queue = true;
    else if (flag === '--n') args.n = readFlagValue(argv, i++, flag);
    else if (flag === '--mb-report') args.mbReport = readFlagValue(argv, i++, flag);
    else if (flag === '--judge-report') args.judgeReport = readFlagValue(argv, i++, flag);
    else if (flag === '--overrides') args.overrides = readFlagValue(argv, i++, flag);
    else if (flag === '--card-audit') args.cardAudit = readFlagValue(argv, i++, flag);
    else throw new Error(`Unknown argument "${flag}"`);
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/triage-apply.js --apply confirmed,corrected',
    '  node scripts/triage-apply.js --sample confirmed [--n 10]',
    '  node scripts/triage-apply.js --queue',
    '      [--mb-report .cache/mb-verify.json] [--judge-report .cache/llm-judge.json]',
    '      [--overrides overrides.json] [--card-audit .cache/card-audit-2026-09-17.json]',
    '',
    `Promotable buckets: ${VALID_BUCKET_NAMES.join(', ')}`,
    `All viewable buckets: ${VALID_VIEW_BUCKET_NAMES.join(', ')}`,
  ].join('\n');
}

function readJson(filePath, action) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed while ${action} from ${filePath}: ${err.message}`, { cause: err });
  }
}

function writeOverrides(filePath, overrides) {
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(overrides, null, 2)}\n`);
  } catch (err) {
    throw new Error(`Failed while writing merged overrides to ${filePath}: ${err.message}`, { cause: err });
  }
}

function readCardAudit(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    // The hand-written audit cache allows trailing commas for easier edits.
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Card audit file ${filePath} not found; queue will omit audit notes.`);
      return null;
    }
    throw new Error(`Failed while reading card audit from ${filePath}: ${err.message}`, { cause: err });
  }
}

function formatRecordLines(record, auditNote) {
  const lines = [];
  for (const field of ['proposal', 'suggestion']) {
    if (record[field]) lines.push(`  ${field}: ${record[field].artist} — ${record[field].title}`);
  }
  if (record.cardTitle) lines.push(`  cardTitle: ${record.cardTitle}`);
  if (record.confirmedBy) lines.push(`  confirmedBy: ${record.confirmedBy}`);
  for (const evidence of record.mbEvidence ?? []) lines.push(`  mbEvidence: ${evidence}`);
  if (record.note) lines.push(`  note: ${record.note}`);
  if (record.reason) lines.push(`  reason: ${record.reason}`);
  if (auditNote) lines.push(`  auditNote: ${auditNote}`);
  return lines;
}

function printRecordBlock(source, filename, record, auditNote) {
  console.log(`[${source}] ${filename}`);
  for (const line of formatRecordLines(record, auditNote)) console.log(line);
}

function printResult(adds, skipped, overridesPath) {
  for (const [filename, entry] of Object.entries(adds)) {
    console.log(`Added ${filename}: ${entry.artist} - ${entry.title}`);
  }
  for (const skippedRecord of skipped) {
    console.log(`Skipped ${skippedRecord.filename} (${skippedRecord.bucket}): ${skippedRecord.reason}`);
  }
  console.log(`Added ${Object.keys(adds).length}; skipped ${skipped.length}.`);
  console.log(`${overridesPath} updated. Overrides apply at next server start; no metadata rescan needed.`);
}

function assertSingleMode(args) {
  const modes = [args.apply, args.sample, args.queue].filter(Boolean);
  if (modes.length !== 1) throw new Error('Choose exactly one mode: --apply, --sample, or --queue');
}

function parseSampleSize(rawValue) {
  const size = Number(rawValue);
  if (!Number.isInteger(size) || size < 0) throw new Error(`--n must be a non-negative integer, got "${rawValue}"`);
  return size;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    assertSingleMode(args);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }

  try {
    const mbReport = readJson(args.mbReport, 'reading MusicBrainz triage report');
    const judgeReport = readJson(args.judgeReport, 'reading LLM judge triage report');

    if (args.sample) {
      for (const { filename, record } of sampleBucket(args.sample, { mbReport, judgeReport }, parseSampleSize(args.n))) {
        printRecordBlock(args.sample, filename, record);
      }
      return;
    }

    if (args.queue) {
      for (const { source, filename, record, auditNote } of buildQueue({ mbReport, judgeReport }, readCardAudit(args.cardAudit))) {
        printRecordBlock(source, filename, record, auditNote);
      }
      return;
    }

    const bucketNames = args.apply.split(',').map((bucket) => bucket.trim()).filter(Boolean);
    assertPromotableBuckets(bucketNames);
    const currentOverrides = readJson(args.overrides, 'reading current overrides');
    const { adds, skipped } = planApply(bucketNames, { mbReport, judgeReport }, currentOverrides);
    const mergedOverrides = { ...currentOverrides, ...adds };
    writeOverrides(args.overrides, mergedOverrides);
    printResult(adds, skipped, args.overrides);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
