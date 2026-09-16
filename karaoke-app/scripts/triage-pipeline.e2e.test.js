// triage-pipeline.e2e.test.js — end-to-end coverage over the metadata-triage
// CLI pipeline (docs/research/llm-assisted-stage1-triage.md): mb-verify.js
// and llm-judge.js run as REAL child processes against fixture input and
// in-test mock servers, asserting the end-state JSON reports. Unit-level
// verdict/receipt logic is already covered by mb-verify.test.js and
// llm-judge.test.js — this file only exercises the wiring: CLI args, file
// I/O, HTTP calls, caching, and resume behavior.
//
// Everything here is offline (mock servers only) and must stay fast — this
// file matches the `npm test` glob, so no real MusicBrainz/llama-server call
// happens except in the RUN_LIVE_JUDGE-gated smoke test at the bottom.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;

// Async on purpose: the in-process mock HTTP servers below run on this same
// event loop, so a *blocking* spawnSync would starve them mid-request and
// every run would hang until its timeout — this bit us during development.
function runScript(relPath, args, env = {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(REPO_ROOT, relPath), ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${relPath} timed out after ${timeoutMs / 1000}s. stdout so far:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Every temp dir is tracked and removed in one process-level after() hook, so
// cleanup happens even when an assertion throws mid-test.
const tempDirs = [];
function mkTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-e2e-'));
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

// ---------------------------------------------------------------------------
// Mock MusicBrainz server — serves canned /ws/2/recording?query=... responses
// from a fixture map keyed by the exact lucene query string mb-verify builds.

function mbCredit(name) {
  return [{ name, joinphrase: '' }];
}

function mbRecording(title, score, artist) {
  return { title, score, 'artist-credit': mbCredit(artist) };
}

// Fixture data mirrors the Alone-Again / Too-Much-Monkey-Business / Bound-to-You
// cases already proven in mb-verify.test.js, reused here as realistic payloads.
const MB_FIXTURES = new Map([
  ['recording:"Sweet Angeline"', [mbRecording('Sweet Angeline', 98, 'Elvis Presley')]],
  ['recording:"Too Much Monkey Business"', [mbRecording('Too Much Monkey Business', 100, 'The Yardbirds')]],
  ['artist:"Elvis Presley" AND recording:"Too Much Monkey Business"',
    [mbRecording('Too Much Monkey Business', 100, 'Elvis Presley')]],
  ['recording:"ALONE AGAIN"', [
    mbRecording('Alone Again', 100, 'Alyssa Reid feat. Jump Smokers'),
    mbRecording('Alone Again', 95, 'Dokken'),
  ]],
  ["artist:\"Gilbert O'Sullivan\" AND recording:\"ALONE AGAIN\"", []],
  ['recording:"Totally Obscure Song"', []],
  ['artist:"Some Artist" AND recording:"Totally Obscure Song"', []],
  ['recording:"BOUND TO YOU"', [
    mbRecording('Bound to You', 100, 'Christina Aguilera'),
    mbRecording('Bound to You', 70, 'Some Cover Band'),
  ]],
]);

function startMbServer() {
  const requests = []; // { query, userAgent }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('query') ?? '';
    requests.push({ query, userAgent: req.headers['user-agent'] ?? '' });
    const recordings = MB_FIXTURES.get(query) ?? [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ recordings }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Mock judge server — implements POST /v1/chat/completions with scripted
// verdict JSON keyed by filename (parsed out of the user message), plus
// GET /v1/models for llm-judge's reachability probe.

function judgeVerdict(overrides) {
  return {
    filename_artist: 'absent', filename_title: 'absent', cardtitle_evidence: 'absent',
    proposal_artist: 'none', proposal_title: 'none',
    agreement: 'filename_and_card_agree', verdict: 'flag_for_human',
    corrected_artist: null, corrected_title: null,
    confidence: 'high', reasoning_note: 'e2e fixture',
    ...overrides,
  };
}

function startJudgeServer(verdictsByFilename) {
  const chatRequests = []; // filename per call
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
        const filename = /^filename: (.*)$/m.exec(userContent)?.[1] ?? '';
        chatRequests.push(filename);
        const verdict = verdictsByFilename[filename] ?? judgeVerdict();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, chatRequests, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// ---------------------------------------------------------------------------

describe('mb-verify.js end-to-end (mock MusicBrainz)', () => {
  let mb;
  let tempDir;

  before(async () => {
    mb = await startMbServer();
  });
  after(async () => {
    await closeServer(mb.server);
  });

  test('runs the full tier set and buckets every record correctly', async () => {
    tempDir = mkTempDir();
    const proposals = {
      likely: {
        '632204': { proposal: { artist: 'Elvis Presley', title: 'Sweet Angeline' }, cardTitle: 'Sweet Angeline' },
        '632206': { proposal: { artist: 'Elvis Presley', title: 'Too Much Monkey Business' } },
      },
      review: {
        '01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)': {
          proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
          cardTitle: 'ALONE AGAIN',
        },
        'obscure-track-xyz': {
          proposal: { artist: 'Some Artist', title: 'Totally Obscure Song' },
          cardTitle: 'Totally Obscure Song',
        },
        '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)': {
          proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
          cardTitle: 'ALONE AGAIN',
        },
      },
      unmatched: {
        '01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)': {
          cardTitle: 'BOUND TO YOU', cardArtist: 'SUNFLY',
        },
      },
    };
    const proposalsPath = path.join(tempDir, 'proposals.json');
    const outPath = path.join(tempDir, 'mb-verify.json');
    const cachePath = path.join(tempDir, 'mb-cache.json');
    fs.writeFileSync(proposalsPath, JSON.stringify(proposals));

    const result = await runScript('scripts/mb-verify.js', [
      '--proposals', proposalsPath, '--out', outPath, '--cache', cachePath,
    ], { MB_ENDPOINT: `http://127.0.0.1:${mb.port}/ws/2/recording`, MB_REQUEST_GAP_MS: '0' });

    assert.equal(result.status, 0, result.stderr);
    const report = readJson(outPath);

    assert.deepEqual(report.summary, { confirmed: 2, corrected: 1, resolved: 1, ambiguous: 1, flagged: 1 });
    assert.ok(report.confirmed['632204']);
    assert.ok(report.confirmed['632206']);
    assert.equal(report.corrected['01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)'].suggestion.artist,
      'Alyssa Reid feat. Jump Smokers');
    assert.ok(report.flagged['obscure-track-xyz']);
    assert.ok(report.resolved['01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)']);
    const ambiguousEntry = report.ambiguous['05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)'];
    assert.ok(ambiguousEntry);
    assert.equal(ambiguousEntry.candidates.length, 2);

    // Every request carried an identifiable User-Agent (MB policy).
    assert.ok(mb.requests.length > 0);
    for (const { userAgent } of mb.requests) {
      assert.match(userAgent, /karaoke-app-mb-verify/);
    }

    // The "needs the artist-scoped second query to confirm" case: exactly
    // two distinct queries reached the server for that title.
    const monkeyBusinessQueries = mb.requests.filter((r) => r.query.includes('Too Much Monkey Business'));
    assert.equal(monkeyBusinessQueries.length, 2);

    // Caching: the two ALONE AGAIN records share a title query and a scoped
    // query, so those queries should each have hit the server exactly once.
    const aloneAgainTitleQueries = mb.requests.filter((r) => r.query === 'recording:"ALONE AGAIN"');
    assert.equal(aloneAgainTitleQueries.length, 1);
  });
});

describe('llm-judge.js end-to-end (mock judge server)', () => {
  test('confirm, receipt-failed fame-pick, and flag_for_human land in the right buckets; resume skips judged records', async () => {
    const tempDir = mkTempDir();
    const reportPath = path.join(tempDir, 'mb-verify.json');
    const outPath = path.join(tempDir, 'llm-judge.json');
    const logPath = path.join(tempDir, 'llm-judge-log.jsonl');

    const mbVerifyReport = {
      ambiguous: {
        // Valid confirm: proposal artist is among the MB candidates.
        '632206': {
          tier: 'likely', cardTitle: 'Too Much Monkey Business',
          proposal: { artist: 'Elvis Presley', title: 'Too Much Monkey Business' },
          candidates: [{ artist: 'Elvis Presley', title: 'Too Much Monkey Business', score: 100 }],
        },
        // Fame-pick correction: Emperor is MB-known but not filename/card backed.
        '632212': {
          tier: 'review', cardTitle: 'Introduction',
          candidates: [{ artist: 'Emperor', title: 'Introduction', score: 98 }],
        },
        // Genuinely ambiguous — model should flag it, and receipts pass.
        '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)': {
          tier: 'review', cardTitle: 'ALONE AGAIN',
          proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
          candidates: [
            { artist: 'Alyssa Reid feat. Jump Smokers', title: 'Alone Again', score: 100 },
            { artist: 'Dokken', title: 'Alone Again', score: 95 },
          ],
        },
      },
    };
    fs.writeFileSync(reportPath, JSON.stringify(mbVerifyReport));

    const verdictsByFilename = {
      '632206': judgeVerdict({ verdict: 'confirm', cardtitle_evidence: 'Too Much Monkey Business' }),
      '632212': judgeVerdict({
        verdict: 'correct', cardtitle_evidence: 'Introduction',
        corrected_artist: 'Emperor', corrected_title: 'Introduction',
      }),
      '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)': judgeVerdict({
        cardtitle_evidence: 'ALONE AGAIN', verdict: 'flag_for_human',
      }),
    };

    const judge = await startJudgeServer(verdictsByFilename);
    try {
      const firstRun = await runScript('scripts/llm-judge.js', [
        '--report', reportPath, '--out', outPath, '--log', logPath,
      ], { JUDGE_URL: `http://127.0.0.1:${judge.port}` });
      assert.equal(firstRun.status, 0, firstRun.stderr);

      const output = readJson(outPath);
      assert.deepEqual(
        Object.keys(output).sort((a, b) => a.localeCompare(b)),
        ['confirmed', 'corrected', 'flagged', 'receipt_failed'].sort((a, b) => a.localeCompare(b)),
      );
      assert.ok(output.confirmed['632206']);
      assert.ok(output.receipt_failed['632212']);
      assert.ok(output.receipt_failed['632212'].receiptFailures.some((f) => f.includes("no backing in the file's own evidence")));
      assert.equal(output.receipt_failed['632212'].modelVerdict.corrected_artist, 'Emperor');
      assert.ok(output.flagged['05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)']);

      // Raw responses were logged for spot-checking.
      const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      assert.equal(logLines.length, 3);

      assert.equal(judge.chatRequests.length, 3);

      // Resume: rerunning against the same --out must skip all three
      // already-judged records — no new chat completions requested.
      const secondRun = await runScript('scripts/llm-judge.js', [
        '--report', reportPath, '--out', outPath, '--log', logPath,
      ], { JUDGE_URL: `http://127.0.0.1:${judge.port}` });
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.equal(judge.chatRequests.length, 3, 'resume run must not re-judge already-judged records');
      assert.match(secondRun.stdout, /All ambiguous records judged\./);
    } finally {
      await closeServer(judge.server);
    }
  });
});

describe('full chain: mb-verify -> llm-judge', () => {
  test('every input record lands in exactly one final bucket; overrides.json and library-cache.json are untouched', async () => {
    const overridesPath = path.join(REPO_ROOT, 'overrides.json');
    const libraryCachePath = path.join(REPO_ROOT, 'library-cache.json');
    const overridesHashBefore = hashFile(overridesPath);
    const libraryCacheHashBefore = hashFile(libraryCachePath);

    const mb = await startMbServer();
    const tempDir = mkTempDir();
    const proposals = {
      likely: {
        '632204': { proposal: { artist: 'Elvis Presley', title: 'Sweet Angeline' }, cardTitle: 'Sweet Angeline' },
      },
      review: {
        '01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)': {
          proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
          cardTitle: 'ALONE AGAIN',
        },
        'obscure-track-xyz': {
          proposal: { artist: 'Some Artist', title: 'Totally Obscure Song' },
          cardTitle: 'Totally Obscure Song',
        },
        '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)': {
          proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
          cardTitle: 'ALONE AGAIN',
        },
      },
      unmatched: {
        '01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)': {
          cardTitle: 'BOUND TO YOU', cardArtist: 'SUNFLY',
        },
      },
    };
    const allFilenames = Object.values(proposals).flatMap((tier) => Object.keys(tier));

    const proposalsPath = path.join(tempDir, 'proposals.json');
    const mbOutPath = path.join(tempDir, 'mb-verify.json');
    const mbCachePath = path.join(tempDir, 'mb-cache.json');
    fs.writeFileSync(proposalsPath, JSON.stringify(proposals));

    try {
      const mbRun = await runScript('scripts/mb-verify.js', [
        '--proposals', proposalsPath, '--out', mbOutPath, '--cache', mbCachePath,
      ], { MB_ENDPOINT: `http://127.0.0.1:${mb.port}/ws/2/recording`, MB_REQUEST_GAP_MS: '0' });
      assert.equal(mbRun.status, 0, mbRun.stderr);
      const mbReport = readJson(mbOutPath);

      const judgeOutPath = path.join(tempDir, 'llm-judge.json');
      const judgeLogPath = path.join(tempDir, 'llm-judge-log.jsonl');
      const judge = await startJudgeServer({
        '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)': judgeVerdict({
          cardtitle_evidence: 'ALONE AGAIN', verdict: 'flag_for_human',
        }),
      });
      try {
        const judgeRun = await runScript('scripts/llm-judge.js', [
          '--report', mbOutPath, '--out', judgeOutPath, '--log', judgeLogPath,
        ], { JUDGE_URL: `http://127.0.0.1:${judge.port}` });
        assert.equal(judgeRun.status, 0, judgeRun.stderr);
        const judgeReport = readJson(judgeOutPath);

        // Every filename lands in exactly one bucket across BOTH reports —
        // confirmed/corrected/resolved/flagged from mb-verify are terminal;
        // only "ambiguous" continues into the judge report's buckets.
        const mbTerminalBuckets = ['confirmed', 'corrected', 'resolved', 'flagged'];
        const landedIn = new Map();
        for (const bucket of mbTerminalBuckets) {
          for (const filename of Object.keys(mbReport[bucket] ?? {})) {
            landedIn.set(filename, `mb-verify:${bucket}`);
          }
        }
        for (const bucket of Object.keys(judgeReport)) {
          for (const filename of Object.keys(judgeReport[bucket])) {
            landedIn.set(filename, `llm-judge:${bucket}`);
          }
        }

        assert.equal(landedIn.size, allFilenames.length);
        for (const filename of allFilenames) {
          assert.ok(landedIn.has(filename), `${filename} never landed in a final bucket`);
        }
        // No record appears in more than one final bucket (Map overwrite
        // would hide that, so cross-check ambiguous vs mb-verify terminals).
        const ambiguousFilenames = new Set(Object.keys(mbReport.ambiguous ?? {}));
        for (const bucket of mbTerminalBuckets) {
          for (const filename of Object.keys(mbReport[bucket] ?? {})) {
            assert.ok(!ambiguousFilenames.has(filename), `${filename} is in both a terminal bucket and ambiguous`);
          }
        }
      } finally {
        await closeServer(judge.server);
      }
    } finally {
      await closeServer(mb.server);
    }

    assert.equal(hashFile(overridesPath), overridesHashBefore, 'overrides.json must never be modified by the triage pipeline');
    assert.equal(hashFile(libraryCachePath), libraryCacheHashBefore, 'library-cache.json must never be modified by the triage pipeline');
  });
});

// ---------------------------------------------------------------------------
// Live smoke test — hits the real llama-server on :8081. Skipped by default;
// the advisor runs it explicitly with RUN_LIVE_JUDGE=1. Never runs as part
// of `npm test`.

test('live smoke: the Alyssa Reid prior-override trap resolves to a passing correction', { skip: process.env.RUN_LIVE_JUDGE !== '1' && 'set RUN_LIVE_JUDGE=1 to run against the real llama-server on :8081' }, async () => {
  const tempDir = mkTempDir();
  const reportPath = path.join(tempDir, 'mb-verify.json');
  const outPath = path.join(tempDir, 'llm-judge.json');
  const logPath = path.join(tempDir, 'llm-judge-log.jsonl');

  const filename = '01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)';
  fs.writeFileSync(reportPath, JSON.stringify({
    ambiguous: {
      [filename]: {
        tier: 'review',
        cardTitle: 'ALONE AGAIN',
        proposal: { artist: "Gilbert O'Sullivan", title: 'Alone Again (Naturally)' },
        candidates: [
          { artist: 'Alyssa Reid feat. Jump Smokers', title: 'Alone Again', score: 100 },
          { artist: 'Dokken', title: 'Alone Again', score: 95 },
        ],
      },
    },
  }));

  // A cold llama-server call (prompt processing from scratch) blew the default
  // 20s during the first advisor run — give the live path real headroom.
  const result = await runScript('scripts/llm-judge.js',
    ['--report', reportPath, '--out', outPath, '--log', logPath], {}, 120_000);
  assert.equal(result.status, 0, result.stderr);

  const output = readJson(outPath);
  assert.ok(output.corrected[filename], `expected a passing correction, got: ${JSON.stringify(output, null, 2)}`);
  // Case-insensitive: the model may quote the artist from the filename
  // ("Feat.") or from the MB candidate ("feat.") — receipts accept both.
  assert.equal(output.corrected[filename].suggestion.artist.toLowerCase(), 'alyssa reid feat. jump smokers');
});
