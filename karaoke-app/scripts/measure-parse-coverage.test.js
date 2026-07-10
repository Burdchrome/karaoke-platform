// Tests for the parse-coverage measurement classifier.
//
// Every example here is a real filename from the library (ticket #3 corpus,
// karaoke-app/unparsed-songs.txt). The bucket taxonomy is ticket #3's, but the
// boundaries were re-derived (the scratchpad classifier is lost) — per-bucket
// counts differ slightly from the #3 comment; the 875 total is identical. This
// script's output is the canonical baseline going forward (see its header).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  isPersonNameShaped,
  discPrefix,
} from './measure-parse-coverage.js';

test('classifyFailure: stray-space disc codes', () => {
  assert.equal(classifyFailure('Ah 8012-01 - Johnny Mathis - Chances Are'), 'stray-space');
  assert.equal(classifyFailure('CB 7002-03'), 'stray-space');
  assert.equal(classifyFailure('CBEP 454-1-06'), 'stray-space');
  assert.equal(classifyFailure('LEG 074-07 - Humperdink, Engelbert - Am I Easy To Forget'), 'stray-space');
});

test('classifyFailure: trackNN / numeric-only names', () => {
  assert.equal(classifyFailure('11'), 'numeric-only');
  assert.equal(classifyFailure('13'), 'numeric-only');
  assert.equal(classifyFailure('Track 07'), 'numeric-only');
  assert.equal(classifyFailure('track12'), 'numeric-only');
});

test('classifyFailure: no separator at all', () => {
  assert.equal(classifyFailure("Ain't Going Down (Till The Sun Comes Up)"), 'no-separator');
  // Underscores but no dash anywhere → still no-separator (matches #3 bucketing)
  assert.equal(classifyFailure('09_Queen_Crazy_Little_Thing_Called_Love'), 'no-separator');
});

test('classifyFailure: underscore-separated (uses _-_ as its separator)', () => {
  assert.equal(classifyFailure('Aerosmith_-_Pink_-_Sc3021-05'), 'underscore');
  assert.equal(classifyFailure('Bob_&_Tom_Band_-_Blow_Me_A_Kiss'), 'underscore');
  assert.equal(classifyFailure('DK801_09_Gospel_-_In_The_Garden'), 'underscore');
});

test('classifyFailure: digits in left side (pass-3 caution branch)', () => {
  assert.equal(classifyFailure('._G06012 - Blue Jean - David Bowie'), 'digits-in-left');
  assert.equal(classifyFailure('._G18677 - I\'m Going Slightly Mad - Queen'), 'digits-in-left');
});

test('classifyFailure: tight-dash only', () => {
  assert.equal(classifyFailure('01.-Alyssa-Reid-Feat.-Jump-Smokers-Alone-Again-(SF313-01)'), 'tight-dash');
  assert.equal(classifyFailure('01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)'), 'tight-dash');
});

test('isPersonNameShaped: detects Last, First titles (suspected inversions)', () => {
  assert.equal(isPersonNameShaped('Sons Of The Pioneers, The'), true);
  assert.equal(isPersonNameShaped('Humperdink, Engelbert'), true);
  // Overcounting flipped titles like "Walk, The" is a KNOWN accepted property
  // of the heuristic (ticket #3) — not asserted either way here.
  assert.equal(isPersonNameShaped('Tumbling Tumbleweeds'), false);
  assert.equal(isPersonNameShaped(''), false);
});

test('discPrefix: extracts the alphabetic prefix of a disc code', () => {
  assert.equal(discPrefix('DKM2014-02'), 'DKM');
  assert.equal(discPrefix('zmp0401'), 'ZMP');
  assert.equal(discPrefix('TU129-17'), 'TU');
  assert.equal(discPrefix(''), '');
});
