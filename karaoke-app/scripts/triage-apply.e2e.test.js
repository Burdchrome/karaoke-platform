// triage-apply.e2e.test.js — end-to-end coverage for the promotion gate CLI
// (issue #28) at the child-process seam, same harness idiom as
// triage-pipeline.e2e.test.js: run the real script on fixture reports and a
// temp overrides copy, assert the file delta and the stdout summary. The
// pure bucket/field logic is covered in triage-apply.test.js.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;

function runScript(args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(REPO_ROOT, 'scripts/triage-apply.js'), ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`triage-apply.js timed out after ${timeoutMs / 1000}s. stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// library-cache.json is a generated scan cache — absent on a cold clone, so
// hash it as "missing" rather than throwing before the suite can run.
function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return 'absent';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const tempDirs = [];
function mkTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-apply-e2e-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Could not remove temp dir ${dir}: ${err.message}`);
    }
  }
});

// Fixture reports shaped like the real .cache files (see mb-verify.json /
// llm-judge.json record shapes in the research doc).
const MB_REPORT = {
  confirmed: {
    '632202': { tier: 'review', proposal: { artist: 'Tony Bennett', title: 'Rags To Riches' }, confirmedBy: 'musicbrainz' },
    '632204': { tier: 'likely', proposal: { artist: 'Elvis Presley', title: 'Sweet Angeline' }, confirmedBy: 'musicbrainz' },
  },
  corrected: {
    '609814': {
      proposal: { artist: 'Black, Clint & Lisa Hartman Black', title: 'Easy For Me To Say' },
      suggestion: { artist: 'Clint Black with Lisa Hartman Black', title: 'Easy for Me to Say' },
    },
  },
  resolved: {
    'bound-to-you-sfkk057-04': { suggestion: { artist: 'Christina Aguilera', title: 'Bound to You' } },
  },
  ambiguous: { 'ambiguous-record': { tier: 'review' } },
  flagged: { 'flagged-record': { reason: 'no MusicBrainz recording matches the title' } },
};

const JUDGE_REPORT = {
  confirmed: {
    'SC7514_12_I_ll_Be_There': { proposal: { artist: 'Carey & Lorenz', title: "I'll Be There" } },
  },
  corrected: {
    'PSJT201-02-TOMORROW-NIGHT': { suggestion: { artist: 'Elvis Presley', title: 'Tomorrow Night' } },
  },
  flagged: { 'judge-flagged-record': {} },
  receipt_failed: { 'receipt-failed-record': {} },
};

// One temp workspace per test: fixture reports + an overrides copy seeded
// with a hand-written entry that collides with confirmed '632202'.
function setUpFixtures() {
  const dir = mkTempDir();
  const mbReportPath = path.join(dir, 'mb-verify.json');
  const judgeReportPath = path.join(dir, 'llm-judge.json');
  const overridesPath = path.join(dir, 'overrides.json');
  fs.writeFileSync(mbReportPath, JSON.stringify(MB_REPORT));
  fs.writeFileSync(judgeReportPath, JSON.stringify(JUDGE_REPORT));
  fs.writeFileSync(overridesPath, JSON.stringify({
    '632202': { artist: 'Hand-Written Ruling', title: 'Kept' },
  }, null, 2));
  return { mbReportPath, judgeReportPath, overridesPath };
}

function applyArgs(fixtures, buckets) {
  return [
    '--apply', buckets,
    '--mb-report', fixtures.mbReportPath,
    '--judge-report', fixtures.judgeReportPath,
    '--overrides', fixtures.overridesPath,
  ];
}

describe('triage-apply.js end-to-end', () => {
  test('promotes exactly the named buckets, skips collisions, reports both, and is idempotent', async () => {
    const fixtures = setUpFixtures();
    const realOverridesHash = hashFile(path.join(REPO_ROOT, 'overrides.json'));
    const realLibraryCacheHash = hashFile(path.join(REPO_ROOT, 'library-cache.json'));

    const run = await runScript(applyArgs(fixtures, 'confirmed,corrected'));
    assert.equal(run.status, 0, run.stderr);

    const overrides = readJson(fixtures.overridesPath);
    // The hand-written collision entry survived untouched.
    assert.deepEqual(overrides['632202'], { artist: 'Hand-Written Ruling', title: 'Kept' });
    // Confirmed promotes the proposal; corrected promotes the suggestion.
    assert.deepEqual(overrides['632204'], { artist: 'Elvis Presley', title: 'Sweet Angeline' });
    assert.deepEqual(overrides['609814'], { artist: 'Clint Black with Lisa Hartman Black', title: 'Easy for Me to Say' });
    // Nothing beyond the named buckets crossed: seed entry + 2 adds.
    assert.equal(Object.keys(overrides).length, 3);

    // The run reports what it added and what it skipped, with counts.
    assert.match(run.stdout, /632204/);
    assert.match(run.stdout, /609814/);
    assert.match(run.stdout, /632202/);
    assert.match(run.stdout, /[Aa]dded 2\b/);
    assert.match(run.stdout, /[Ss]kipped 1\b/);

    // Idempotence: the same apply again adds zero entries.
    const rerun = await runScript(applyArgs(fixtures, 'confirmed,corrected'));
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.match(rerun.stdout, /[Aa]dded 0\b/);
    assert.deepEqual(readJson(fixtures.overridesPath), overrides);

    // The real overrides and library cache were never touched.
    assert.equal(hashFile(path.join(REPO_ROOT, 'overrides.json')), realOverridesHash);
    assert.equal(hashFile(path.join(REPO_ROOT, 'library-cache.json')), realLibraryCacheHash);
  });

  test('judge:-prefixed buckets promote from the judge report with the same field mapping', async () => {
    const fixtures = setUpFixtures();
    const run = await runScript(applyArgs(fixtures, 'judge:confirmed,judge:corrected,resolved'));
    assert.equal(run.status, 0, run.stderr);

    const overrides = readJson(fixtures.overridesPath);
    assert.deepEqual(overrides['SC7514_12_I_ll_Be_There'], { artist: 'Carey & Lorenz', title: "I'll Be There" });
    assert.deepEqual(overrides['PSJT201-02-TOMORROW-NIGHT'], { artist: 'Elvis Presley', title: 'Tomorrow Night' });
    assert.deepEqual(overrides['bound-to-you-sfkk057-04'], { artist: 'Christina Aguilera', title: 'Bound to You' });
  });

  test('an unknown bucket name fails loudly with a non-zero exit and changes nothing', async () => {
    const fixtures = setUpFixtures();
    const before = hashFile(fixtures.overridesPath);
    const run = await runScript(applyArgs(fixtures, 'confimed'));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /confimed/);
    assert.equal(hashFile(fixtures.overridesPath), before);
  });

  test('a missing or corrupt input file fails loudly, naming the file and what was being attempted', async () => {
    const fixtures = setUpFixtures();
    const before = hashFile(fixtures.overridesPath);

    // Missing report file: the error names the path, and nothing is written.
    const missingPath = path.join(path.dirname(fixtures.mbReportPath), 'nope.json');
    const missingRun = await runScript([
      '--apply', 'confirmed',
      '--mb-report', missingPath,
      '--judge-report', fixtures.judgeReportPath,
      '--overrides', fixtures.overridesPath,
    ]);
    assert.notEqual(missingRun.status, 0);
    assert.match(missingRun.stderr, /nope\.json/);
    assert.equal(hashFile(fixtures.overridesPath), before);

    // Corrupt overrides file: same loud-failure contract.
    fs.writeFileSync(fixtures.overridesPath, '{ not json');
    const corruptRun = await runScript(applyArgs(fixtures, 'confirmed'));
    assert.notEqual(corruptRun.status, 0);
    assert.match(corruptRun.stderr, /overrides/i);
    assert.equal(fs.readFileSync(fixtures.overridesPath, 'utf8'), '{ not json');
  });

  test('human-queue buckets are refused, even when named alongside a valid one', async () => {
    const fixtures = setUpFixtures();
    const before = hashFile(fixtures.overridesPath);
    for (const buckets of ['flagged', 'ambiguous', 'judge:flagged', 'judge:receipt_failed', 'confirmed,flagged']) {
      const run = await runScript(applyArgs(fixtures, buckets));
      assert.notEqual(run.status, 0, `bucket list "${buckets}" must be refused`);
      assert.equal(hashFile(fixtures.overridesPath), before, `bucket list "${buckets}" must change nothing`);
    }
  });
});
