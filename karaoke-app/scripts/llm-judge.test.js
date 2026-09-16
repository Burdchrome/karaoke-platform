import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, validateReceipts } from './llm-judge.js';

const baseVerdict = {
  filename_artist: 'absent', filename_title: 'absent', cardtitle_evidence: 'absent',
  proposal_artist: 'none', proposal_title: 'none',
  agreement: 'filename_and_card_agree', verdict: 'flag_for_human',
  corrected_artist: null, corrected_title: null,
  confidence: 'high', reasoning_note: 'test',
};

test('buildMessages includes all candidates and marks a missing proposal', () => {
  const [system, user] = buildMessages({
    filename: '632212', cardTitle: 'Introduction', proposal: undefined,
    candidates: [{ artist: 'Emperor', title: 'Introduction', score: 98 }],
  });
  assert.equal(system.role, 'system');
  assert.match(user.content, /machine_proposal: none/);
  assert.match(user.content, /Emperor — Introduction \(MB score 98\)/);
});

test('confirm passes when the proposal artist is among the MB candidates', () => {
  const failures = validateReceipts(
    {
      filename: '632206', cardTitle: 'Too Much Monkey Business',
      proposal: { artist: 'Elvis Presley', title: 'Too Much Monkey Business' },
      candidates: [{ artist: 'Elvis Presley', title: 'Too Much Monkey Business', score: 100 }],
    },
    { ...baseVerdict, verdict: 'confirm', cardtitle_evidence: 'Too Much Monkey Business' }
  );
  assert.deepEqual(failures, []);
});

test('confirm is demoted when no evidence source backs the proposal artist', () => {
  const failures = validateReceipts(
    {
      filename: '632213', cardTitle: 'Down By The Riverside',
      proposal: { artist: 'Standard Reminiscing', title: 'Down By The Riverside' },
      candidates: [{ artist: 'Raffi', title: 'Down by the Riverside', score: 100 }],
    },
    { ...baseVerdict, verdict: 'confirm', cardtitle_evidence: 'Down By The Riverside' }
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /backed by no evidence source/);
});

test('correct passes when the replacement is MB-known AND file-backed', () => {
  const failures = validateReceipts(
    {
      filename: '01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)',
      cardTitle: 'ALONE AGAIN',
      proposal: { artist: 'Gilbert O\'Sullivan', title: 'Alone Again (Naturally)' },
      candidates: [{ artist: 'Alyssa Reid feat. Jump Smokers', title: 'Alone Again', score: 100 }],
    },
    {
      ...baseVerdict, verdict: 'correct',
      filename_artist: 'Alyssa Reid Feat. Jump Smokers', filename_title: 'Alone Again',
      cardtitle_evidence: 'ALONE AGAIN',
      corrected_artist: 'Alyssa Reid feat. Jump Smokers', corrected_title: 'Alone Again',
    }
  );
  assert.deepEqual(failures, []);
});

test('correct is demoted when the replacement has no file backing (fame-pick)', () => {
  const failures = validateReceipts(
    {
      filename: '632212', cardTitle: 'Introduction',
      candidates: [{ artist: 'Emperor', title: 'Introduction', score: 98 }],
    },
    {
      ...baseVerdict, verdict: 'correct', cardtitle_evidence: 'Introduction',
      corrected_artist: 'Emperor', corrected_title: 'Introduction',
    }
  );
  assert.ok(failures.some((f) => f.includes('no backing in the file\'s own evidence')));
});

test('fabricated filename quotes are a receipt failure', () => {
  const failures = validateReceipts(
    { filename: '632206', cardTitle: 'Too Much Monkey Business', candidates: [] },
    { ...baseVerdict, filename_artist: 'Elvis Presley', cardtitle_evidence: 'Too Much Monkey Business' }
  );
  assert.ok(failures.some((f) => f.includes('does not appear in the filename')));
});

test('card-title misquote is a receipt failure', () => {
  const failures = validateReceipts(
    { filename: 'x', cardTitle: 'BOUND TO YOU', candidates: [] },
    { ...baseVerdict, cardtitle_evidence: 'COMPLETELY DIFFERENT' }
  );
  assert.ok(failures.some((f) => f.includes('does not match the card')));
});

test('confirm on a proposal-less record is a receipt failure', () => {
  const failures = validateReceipts(
    { filename: 'x', cardTitle: 'T', candidates: [] },
    { ...baseVerdict, verdict: 'confirm', cardtitle_evidence: 'T' }
  );
  assert.ok(failures.some((f) => f.includes('no proposal')));
});

test('flag_for_human always passes receipts', () => {
  const failures = validateReceipts(
    { filename: 'x', cardTitle: 'T', candidates: [] },
    { ...baseVerdict, cardtitle_evidence: 'T' }
  );
  assert.deepEqual(failures, []);
});
