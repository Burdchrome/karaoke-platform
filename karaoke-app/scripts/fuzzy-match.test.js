import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokens, containsAllTokens, stripFeatClause, tokenSetSimilarity, jaroWinkler,
} from './fuzzy-match.js';

test('tokens splits dash-packed filenames into comparable words', () => {
  assert.deepEqual(
    tokens('13.-Fun.-Feat.-Janelle-Monae-We-Are-Young-(SF314-13)'),
    ['13', 'fun', 'feat', 'janelle', 'monae', 'we', 'are', 'young', 'sf314', '13']
  );
});

test('containsAllTokens confirms order-free artist presence', () => {
  const filename = tokens('05.-Cassidy,-Eva-Songbird-(SF200-05)');
  assert.equal(containsAllTokens(filename, tokens('Eva Cassidy')), true);
  assert.equal(containsAllTokens(filename, tokens('Gilbert O\'Sullivan')), false);
  assert.equal(containsAllTokens(filename, []), false);
});

test('stripFeatClause removes feature credits but keeps the base artist', () => {
  assert.equal(stripFeatClause('Fun. feat. Janelle Monae'), 'Fun.');
  assert.equal(stripFeatClause('Alyssa Reid Feat. Jump Smokers'), 'Alyssa Reid');
  assert.equal(stripFeatClause('Pink ft Nate Ruess'), 'Pink');
  assert.equal(stripFeatClause('Simon & Garfunkel'), 'Simon & Garfunkel');
});

test('tokenSetSimilarity passes annotation noise, fails truncations', () => {
  // Extra "(Glee)" token should not break a real match at the 0.85 threshold.
  assert.ok(tokenSetSimilarity('We Are Young', 'We Are Young (Glee)') >= 0.85);
  // The known truncation trap must NOT auto-match — it needs a human/LLM eye.
  assert.ok(tokenSetSimilarity('Alone Again', 'Alone Again (Naturally)') < 0.85);
  assert.equal(tokenSetSimilarity('Bound To You', 'Bound To You'), 1);
  assert.equal(tokenSetSimilarity('', 'Anything'), 0);
});

test('jaroWinkler behaves on identity, typos, and disjoint strings', () => {
  assert.equal(jaroWinkler('Elvis Presley', 'Elvis Presley'), 1);
  assert.ok(jaroWinkler('Janelle Monae', 'Janelle Monáe'.normalize('NFD').replace(/\p{M}/gu, '')) >= 0.9);
  assert.ok(jaroWinkler('Katrina & The Waves', 'Katrina And The Waves') >= 0.85);
  assert.ok(jaroWinkler('Elvis Presley', 'Dokken') < 0.6);
  assert.equal(jaroWinkler('', 'x'), 0);
});
