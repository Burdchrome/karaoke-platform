import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTitleFor, extractCandidates, judgeRecord } from './mb-verify.js';

const mbResponse = (recordings) => ({ recordings });
const credit = (name) => [{ name, joinphrase: '' }];

test('searchTitleFor strips card decoration, falls back to the proposal', () => {
  assert.equal(searchTitleFor({ cardTitle: 'ALONE AGAIN... (Am)' }), 'ALONE AGAIN');
  assert.equal(searchTitleFor({ cardTitle: null, proposal: { title: 'Sweet Angeline' } }), 'Sweet Angeline');
  assert.equal(searchTitleFor({}), '');
});

test('extractCandidates keeps title matches, dedupes artists by best score', () => {
  const candidates = extractCandidates(mbResponse([
    { title: 'We Are Young', score: 100, 'artist-credit': [{ name: 'fun.', joinphrase: ' feat. ' }, { name: 'Janelle Monáe', joinphrase: '' }] },
    { title: 'We Are Young', score: 90, 'artist-credit': credit('fun.') },
    { title: 'We Are Young and Restless', score: 80, 'artist-credit': credit('Somebody Else') },
  ]), 'We Are Young');
  // Both fun. credits share a base artist → one candidate; the off-title drops.
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].artist, 'fun. feat. Janelle Monáe');
  assert.equal(candidates[0].score, 100);
});

test('confirmed: MB knows the proposed pairing and no rival has file evidence', () => {
  const result = judgeRecord(
    { filename: '632204', proposal: { artist: 'Elvis Presley', title: 'Sweet Angeline' }, cardTitle: 'Sweet Angeline' },
    [{ artist: 'Elvis Presley', title: 'Sweet Angeline', score: 98, titleSimilarity: 1 }]
  );
  assert.equal(result.verdict, 'confirmed');
  assert.equal(result.confirmedBy, 'musicbrainz'); // numeric filename = no file evidence
});

test('corrected: the Alyssa Reid case — proposal absent from MB, one filename-backed rival', () => {
  const result = judgeRecord(
    {
      filename: '01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)',
      proposal: { artist: 'Gilbert O\'Sullivan', title: 'Alone Again (Naturally)' },
      cardTitle: 'ALONE AGAIN',
    },
    [
      { artist: 'Alyssa Reid feat. Jump Smokers', title: 'Alone Again', score: 100, titleSimilarity: 1 },
      { artist: 'Dokken', title: 'Alone Again', score: 95, titleSimilarity: 1 },
      // Gilbert's actual title "Alone Again (Naturally)" fails the 0.85 title
      // gate in extractCandidates, so he never appears here — by design.
    ]
  );
  assert.equal(result.verdict, 'corrected');
  assert.equal(result.suggestion.artist, 'Alyssa Reid feat. Jump Smokers');
});

test('resolved: unmatched record where evidence + MB name exactly one artist', () => {
  const result = judgeRecord(
    { filename: '01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)', cardTitle: 'BOUND TO YOU', cardArtist: 'SUNFLY' },
    [
      { artist: 'Christina Aguilera', title: 'Bound to You', score: 100, titleSimilarity: 1 },
      { artist: 'Some Cover Band', title: 'Bound to You', score: 70, titleSimilarity: 1 },
    ]
  );
  assert.equal(result.verdict, 'resolved');
  assert.equal(result.suggestion.artist, 'Christina Aguilera');
});

test('brand card artists never count as evidence', () => {
  const result = judgeRecord(
    { filename: '632299', cardTitle: 'BOUND TO YOU', cardArtist: 'SUNFLY' },
    [
      { artist: 'Christina Aguilera', title: 'Bound to You', score: 100, titleSimilarity: 1 },
      { artist: 'Some Cover Band', title: 'Bound to You', score: 70, titleSimilarity: 1 },
    ]
  );
  // No filename tokens, brand card artist ignored → nobody is evidence-backed.
  assert.equal(result.verdict, 'ambiguous');
});

test('flagged: MusicBrainz has nothing for the title', () => {
  const withProposal = judgeRecord(
    { filename: 'x', proposal: { artist: 'A', title: 'T' }, cardTitle: 'T' }, []
  );
  assert.equal(withProposal.verdict, 'flagged');
  const withoutProposal = judgeRecord({ filename: 'x', cardTitle: 'T' }, []);
  assert.equal(withoutProposal.verdict, 'flagged');
});

test('ambiguous: two rivals both backed by the filename', () => {
  const result = judgeRecord(
    { filename: '05.-Dokken-Vs-Alyssa-Reid-Alone-Again-(SF999-05)', proposal: { artist: 'Gilbert O\'Sullivan', title: 'Alone Again (Naturally)' }, cardTitle: 'ALONE AGAIN' },
    [
      { artist: 'Alyssa Reid', title: 'Alone Again', score: 100, titleSimilarity: 1 },
      { artist: 'Dokken', title: 'Alone Again', score: 95, titleSimilarity: 1 },
    ]
  );
  assert.equal(result.verdict, 'ambiguous');
  assert.equal(result.mbEvidence.length, 2);
});
