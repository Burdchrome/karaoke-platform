// Parser tests for ticket #10 — comma-shape inversion fix (spec §1a).
//
// Rule under test: in a "DISC - X - Y" parse, when exactly ONE of X/Y is
// shaped like "Last, First", that segment is the artist regardless of the
// title-first prefix table. The table is only the tiebreak when neither or
// both segments match.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilename, isPersonNameShaped, TITLE_FIRST_PREFIXES } from './library.js';

// --- comma-shape heuristic: the three cases from the acceptance criteria ---

test('one comma-shaped segment wins over the prefix table (inverted DKM file)', () => {
  // DKM is title-first, but this file is actually DISC - ARTIST - TITLE.
  // The comma shape on the middle segment should override the table.
  const song = parseFilename('DKM2014-02 - Brooks, Garth - The Dance');
  assert.equal(song.artist, 'Garth Brooks');
  assert.equal(song.title, 'The Dance');
  assert.equal(song.discCode, 'DKM2014-02');
});

test('comma-shaped TITLE in a clean pack does NOT flip (heuristic is scoped)', () => {
  // PHM is not title-first. "Oh Well, Oh Well" is a comma-shaped title —
  // running the heuristic here would invert ~1,100 correct files (measured),
  // so clean packs keep plain DISC - ARTIST - TITLE order.
  const song = parseFilename('PHM1201-05 - Mayday Parade - Oh Well, Oh Well');
  assert.equal(song.artist, 'Mayday Parade');
  assert.equal(song.title, 'Oh Well, Oh Well');
});

test('title-first-order file in a mixed pack still parses via the table', () => {
  // DKM file actually in DISC - TITLE - ARTIST order: comma shape agrees
  // with the table (last segment is the artist).
  const song = parseFilename('DKM2014-07 - The Dance - Brooks, Garth');
  assert.equal(song.artist, 'Garth Brooks');
  assert.equal(song.title, 'The Dance');
});

test('both segments comma-shaped falls back to the prefix table', () => {
  // Ambiguous — DKM is title-first, so last segment is the artist.
  const song = parseFilename('DKM2014-05 - Luck, Be A Lady - Sinatra, Frank');
  assert.equal(song.artist, 'Frank Sinatra');
  assert.equal(song.title, 'Luck, Be A Lady');
});

test('neither segment comma-shaped falls back to the prefix table', () => {
  const titleFirst = parseFilename('ZMP001-01 - Angels - Robbie Williams');
  assert.equal(titleFirst.artist, 'Robbie Williams');
  assert.equal(titleFirst.title, 'Angels');

  const normalOrder = parseFilename('SC8100-01 - Fleetwood Mac - Dreams');
  assert.equal(normalOrder.artist, 'Fleetwood Mac');
  assert.equal(normalOrder.title, 'Dreams');
});

// --- regression guards: currently-correct parses must not change ---

test('regression: disc code at the END still parses', () => {
  const song = parseFilename('Adele - Hello - 50052');
  assert.equal(song.artist, 'Adele');
  assert.equal(song.title, 'Hello');
  assert.equal(song.discCode, '50052');
});

test('regression: dash-in-name artist survives the greedy split', () => {
  const song = parseFilename('SC2301-12 - Ne-Yo - So Sick');
  assert.equal(song.artist, 'Ne-Yo');
  assert.equal(song.title, 'So Sick');
});

test('regression: no disc code, "Artist - Title" with comma normalization', () => {
  const song = parseFilename('Beatles, The - Across The Universe');
  assert.equal(song.artist, 'The Beatles');
  assert.equal(song.title, 'Across The Universe');
  assert.equal(song.discCode, '');
});

test('regression: unparseable name falls through to title-only', () => {
  const song = parseFilename('CBEP 454-1-06');
  assert.equal(song.artist, '');
  assert.equal(song.title, 'CBEP 454-1-06');
});

// --- ticket #11: stray-space disc codes (spec §1b) ---

test('stray-space disc code collapses and parses normally', () => {
  const song = parseFilename('SC 8385-15 - Garth Brooks - The Dance');
  assert.equal(song.discCode, 'SC8385-15');
  assert.equal(song.artist, 'Garth Brooks');
  assert.equal(song.title, 'The Dance');
});

test('code-only stray-space file still fails cleanly (belongs to #8)', () => {
  const song = parseFilename('CBEP 454-1-06');
  assert.equal(song.artist, '');
  assert.equal(song.title, 'CBEP 454-1-06');
  assert.equal(song.discCode, '');
});

test('digits-in-artist name is not mistaken for a stray-space code', () => {
  // "Blink 182" has no dashed digit group, so the stray-space pass must not
  // turn it into a disc code. It stays in the digits-in-left caution bucket
  // (out of scope per spec §1 — still a clean title-only fallback).
  const song = parseFilename('Blink 182 - All The Small Things');
  assert.equal(song.discCode, '');
  assert.equal(song.artist, '');
  assert.equal(song.title, 'Blink 182 - All The Small Things');
});

// --- ticket #11: underscore separators (spec §1c) ---

test('underscore-separated filename parses after translation', () => {
  const song = parseFilename('_Asleep_At_The_Wheel_-_Blues_For_Dixie');
  assert.equal(song.artist, 'Asleep At The Wheel');
  assert.equal(song.title, 'Blues For Dixie');
  assert.equal(song.discCode, '');
});

test('underscores inside fields are de-underscored on output', () => {
  // Currently "parses" with underscores intact — ugly-parse cleanup.
  const song = parseFilename('SC8100-01 - Fleetwood_Mac - Go_Your_Own_Way');
  assert.equal(song.artist, 'Fleetwood Mac');
  assert.equal(song.title, 'Go Your Own Way');
  assert.equal(song.discCode, 'SC8100-01');
});

test('underscore-in-disc-code files keep parsing after translation', () => {
  // "CB6084_09" used to ugly-parse via the underscore-tolerant code regex;
  // after _ → space the code must rejoin as "CB6084-09", not fail.
  const song = parseFilename('CB6084_09_-_Alabama_-_If_I_Had_You');
  assert.equal(song.discCode, 'CB6084-09');
  assert.equal(song.artist, 'Alabama');
  assert.equal(song.title, 'If I Had You');
});

test('split code + track number rejoins ("sc_8119_-_02_-_artist_-_title")', () => {
  const song = parseFilename("sc_8119_-_07_-_linda_ronstadt_&_james_ingram_-_somewhere_out_");
  assert.equal(song.discCode, 'sc8119-07');
  assert.equal(song.artist, 'linda ronstadt & james ingram');
  assert.equal(song.title, 'somewhere out');
});

test('dashed track suffix after spaced code rejoins ("CB5102_02-11 - …")', () => {
  const song = parseFilename('CB5102_02-11 - Presley, Elvis - Without Him');
  assert.equal(song.discCode, 'CB5102-02-11');
  assert.equal(song.artist, 'Elvis Presley');
  assert.equal(song.title, 'Without Him');
});

// --- shared shape helper (consolidated from the measurement script) ---

test('isPersonNameShaped matches Last, First and rejects non-names', () => {
  assert.equal(isPersonNameShaped('Brooks, Garth'), true);
  assert.equal(isPersonNameShaped('The Dance'), false);
  assert.equal(isPersonNameShaped(''), false);
  assert.equal(isPersonNameShaped('one, two, three'), false);
});

test('TITLE_FIRST_PREFIXES is exported for the measurement script', () => {
  assert.equal(TITLE_FIRST_PREFIXES.has('DKM'), true);
  assert.equal(TITLE_FIRST_PREFIXES.has('SC'), false);
});
