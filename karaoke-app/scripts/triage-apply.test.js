// triage-apply.test.js — unit coverage for the promotion gate's pure logic
// (issue #28): bucket resolution and field mapping. The CLI/file wiring is
// covered by triage-apply.e2e.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planApply } from './triage-apply.js';

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
