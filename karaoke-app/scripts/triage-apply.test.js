// triage-apply.test.js — unit coverage for the promotion gate's pure logic
// (issue #28: bucket resolution and field mapping) and the read-only views'
// pure logic (issue #29: sampling and human-queue assembly). The CLI/file
// wiring is covered by triage-apply.e2e.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planApply, sampleBucket, buildQueue } from './triage-apply.js';

const mbReport = {
  confirmed: {
    '632202': { proposal: { artist: 'Tony Bennett', title: 'Rags To Riches' } },
    '632204': { proposal: { artist: 'Elvis Presley', title: 'Sweet Angeline' } },
    'record-missing-proposal': { cardTitle: 'Orphan Card' },
  },
  corrected: {
    '609814': {
      proposal: { artist: 'Black, Clint & Lisa Hartman Black', title: 'Easy For Me To Say' },
      suggestion: { artist: 'Clint Black with Lisa Hartman Black', title: 'Easy for Me to Say' },
    },
  },
  resolved: {
    'bound-to-you-sfkk057-04': {
      suggestion: { artist: 'Christina Aguilera', title: 'Bound to You' },
    },
  },
  ambiguous: { 'ambiguous-record': {} },
  flagged: { 'flagged-record': { reason: 'no MusicBrainz recording matches the title' } },
};

const judgeReport = {
  confirmed: {
    'SC7514_12_I_ll_Be_There': { proposal: { artist: 'Carey & Lorenz', title: "I'll Be There" } },
  },
  corrected: {
    'PSJT201-02-TOMORROW-NIGHT': {
      suggestion: { artist: 'Elvis Presley', title: 'Tomorrow Night' },
    },
  },
  flagged: { 'judge-flagged-record': {} },
  receipt_failed: { 'receipt-failed-record': {} },
};

const reports = { mbReport, judgeReport };

test('confirmed promotes the proposal; corrected and resolved promote the suggestion', () => {
  const plan = planApply(['confirmed', 'corrected', 'resolved'], reports, {});
  assert.deepEqual(plan.adds['632202'], { artist: 'Tony Bennett', title: 'Rags To Riches' });
  assert.deepEqual(plan.adds['609814'], { artist: 'Clint Black with Lisa Hartman Black', title: 'Easy for Me to Say' });
  assert.deepEqual(plan.adds['bound-to-you-sfkk057-04'], { artist: 'Christina Aguilera', title: 'Bound to You' });
});

test('judge: prefix addresses the judge report with the same field mapping', () => {
  const plan = planApply(['judge:confirmed', 'judge:corrected'], reports, {});
  assert.deepEqual(plan.adds['SC7514_12_I_ll_Be_There'], { artist: 'Carey & Lorenz', title: "I'll Be There" });
  assert.deepEqual(plan.adds['PSJT201-02-TOMORROW-NIGHT'], { artist: 'Elvis Presley', title: 'Tomorrow Night' });
});

test('only the named buckets are promoted — nothing by default', () => {
  const plan = planApply(['corrected'], reports, {});
  assert.deepEqual(Object.keys(plan.adds), ['609814']);
});

test('existing override entries win on collision, and the skip carries its reason', () => {
  const existing = { '632202': { artist: 'Hand-Written Ruling', title: 'Kept' } };
  const plan = planApply(['confirmed'], reports, existing);
  assert.equal(plan.adds['632202'], undefined);
  assert.deepEqual(plan.adds['632204'], { artist: 'Elvis Presley', title: 'Sweet Angeline' });
  const collision = plan.skipped.find((s) => s.filename === '632202');
  assert.ok(collision, 'collision must be reported in skipped');
  assert.match(collision.reason, /override/i);
});

test('a record missing its promotable field is skipped, not promoted as garbage', () => {
  const plan = planApply(['confirmed'], reports, {});
  assert.equal(plan.adds['record-missing-proposal'], undefined);
  assert.ok(plan.skipped.some((s) => s.filename === 'record-missing-proposal'));
});

test('unknown bucket names throw loudly', () => {
  assert.throws(() => planApply(['confimed'], reports, {}), /confimed/);
  assert.throws(() => planApply(['judge:resolved'], reports, {}), /judge:resolved/);
});

test('human-queue buckets are never promotable', () => {
  for (const bucket of ['flagged', 'ambiguous', 'judge:flagged', 'judge:receipt_failed']) {
    assert.throws(() => planApply([bucket], reports, {}), new RegExp(bucket), `${bucket} must not be promotable`);
  }
});

// --- issue #29: read-only views -------------------------------------------

test('sampleBucket deals at most N records from the named bucket, evidence intact', () => {
  const sample = sampleBucket('confirmed', reports, 2);
  assert.equal(sample.length, 2);
  for (const record of sample) {
    assert.ok(mbReport.confirmed[record.filename], `${record.filename} must come from the confirmed bucket`);
    assert.deepEqual(record.record, mbReport.confirmed[record.filename]);
  }
  // Asking for more than the bucket holds deals the whole bucket, once each.
  const whole = sampleBucket('corrected', reports, 10);
  assert.equal(whole.length, 1);
  assert.equal(whole[0].filename, '609814');
});

test('sampleBucket reaches judge and human-queue buckets too, but throws on unknown names', () => {
  assert.equal(sampleBucket('judge:flagged', reports, 5)[0].filename, 'judge-flagged-record');
  assert.equal(sampleBucket('flagged', reports, 5)[0].filename, 'flagged-record');
  assert.throws(() => sampleBucket('confimed', reports, 5), /confimed/);
});

const queueMbReport = {
  confirmed: {},
  corrected: {},
  resolved: {},
  ambiguous: {
    'Cracklin Rose': {
      proposal: { artist: 'Neil Diamond', title: "Cracklin' Rosie" },
      note: 'MB knows the pairing, but the filename carries unexplained words: "rose"',
    },
    'Long version In My Way': {
      proposal: { artist: 'Elvis Presley', title: 'In My Way' },
      note: 'MB knows the pairing, but the filename carries unexplained words: "long version"',
    },
    'still-just-ambiguous': { proposal: { artist: 'Someone', title: 'Something' } },
  },
  flagged: {
    'talking heads-road to nowhere': { reason: 'no MusicBrainz recording matches the title' },
  },
};

const queueJudgeReport = {
  confirmed: {},
  corrected: {},
  flagged: { 'judge-flagged-record': {} },
  receipt_failed: { 'receipt-failed-record': {} },
};

const queueCardAudit = {
  cardContradicts: {
    'talking heads-road to nowhere': {
      cardTruth: 'writers Byrne/Frantz/Weymouth/Harrison (Talking Heads) — performer line absent',
      suggested: { artist: 'Talking Heads', title: 'Road To Nowhere' },
    },
  },
  convictionOverturned: {
    'Long version In My Way': {
      pipelineSaid: 'Elvis Presley — In My Way',
      resolution: '2026-09-17 lyric research: on-frame lyrics match Elvis Presley. Elvis attribution stands, lyric-verified.',
    },
  },
  cardSilent: ["Cracklin Rose (title on card = 'Cracklin' Rosie')"],
};

test('buildQueue lists flagged + judge-flagged + receipt-failed + demoted, and nothing else', () => {
  const queue = buildQueue({ mbReport: queueMbReport, judgeReport: queueJudgeReport }, queueCardAudit);
  const bySource = Object.groupBy(queue, (entry) => entry.source);
  assert.deepEqual(bySource.flagged.map((e) => e.filename), ['talking heads-road to nowhere']);
  assert.deepEqual(bySource['judge:flagged'].map((e) => e.filename), ['judge-flagged-record']);
  assert.deepEqual(bySource['judge:receipt_failed'].map((e) => e.filename), ['receipt-failed-record']);
  // Demoted = ambiguous records carrying the demotion note; plain ambiguous stays out.
  assert.deepEqual(bySource.demoted.map((e) => e.filename), ['Cracklin Rose', 'Long version In My Way']);
  assert.equal(queue.length, 5);
});

test('convictionOverturned notes surface as their resolution text, not raw JSON', () => {
  const queue = buildQueue({ mbReport: queueMbReport, judgeReport: queueJudgeReport }, queueCardAudit);
  const overturned = queue.find((e) => e.filename === 'Long version In My Way');
  assert.match(overturned.auditNote, /lyric research/);
  assert.doesNotMatch(overturned.auditNote, /[{}"]/, 'the note must be the resolution text, not a JSON blob');
});

test('buildQueue attaches card-audit notes where the audit covers a record', () => {
  const queue = buildQueue({ mbReport: queueMbReport, judgeReport: queueJudgeReport }, queueCardAudit);
  const flagged = queue.find((e) => e.filename === 'talking heads-road to nowhere');
  assert.match(flagged.auditNote, /performer line absent/);
  // cardSilent entries are free text — matched by prefix against the record key.
  const demoted = queue.find((e) => e.filename === 'Cracklin Rose');
  assert.match(demoted.auditNote, /title on card/);
  // No audit coverage -> no note.
  const judged = queue.find((e) => e.filename === 'judge-flagged-record');
  assert.equal(judged.auditNote, undefined);
});

test('buildQueue works without a card audit (gitignored cache may be absent)', () => {
  const queue = buildQueue({ mbReport: queueMbReport, judgeReport: queueJudgeReport }, null);
  assert.equal(queue.length, 5);
  assert.ok(queue.every((entry) => entry.auditNote === undefined));
});
