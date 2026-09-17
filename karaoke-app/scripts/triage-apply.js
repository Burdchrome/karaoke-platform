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
//       [--mb-report .cache/mb-verify.json] [--judge-report .cache/llm-judge.json]
//       [--overrides overrides.json]
//
// Bucket names: bare = the mb-verify report (confirmed, corrected, resolved);
// judge:confirmed / judge:corrected = the LLM judge report. Confirmed buckets
// promote the record's proposal; corrected/resolved promote the suggestion.

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
    mbReport: '.cache/mb-verify.json',
    judgeReport: '.cache/llm-judge.json',
    overrides: 'overrides.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = readFlagValue(argv, i++, flag);
    else if (flag === '--mb-report') args.mbReport = readFlagValue(argv, i++, flag);
    else if (flag === '--judge-report') args.judgeReport = readFlagValue(argv, i++, flag);
    else if (flag === '--overrides') args.overrides = readFlagValue(argv, i++, flag);
    else throw new Error(`Unknown argument "${flag}"`);
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/triage-apply.js --apply confirmed,corrected',
    '      [--mb-report .cache/mb-verify.json] [--judge-report .cache/llm-judge.json]',
    '      [--overrides overrides.json]',
    '',
    `Valid bucket names: ${VALID_BUCKET_NAMES.join(', ')}`,
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

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }

  if (!args.apply) {
    console.error(usage());
    process.exit(1);
  }

  const bucketNames = args.apply.split(',').map((bucket) => bucket.trim()).filter(Boolean);
  try {
    assertPromotableBuckets(bucketNames);

    const mbReport = readJson(args.mbReport, 'reading MusicBrainz triage report');
    const judgeReport = readJson(args.judgeReport, 'reading LLM judge triage report');
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
