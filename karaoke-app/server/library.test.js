// Parser tests for ticket #10 — comma-shape inversion fix (spec §1a).
//
// Rule under test: in a "DISC - X - Y" parse, when exactly ONE of X/Y is
// shaped like "Last, First", that segment is the artist regardless of the
// title-first prefix table. The table is only the tiebreak when neither or
// both segments match.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilename,
  isPersonNameShaped,
  TITLE_FIRST_PREFIXES,
  normalizeSongField,
  makeSongKey,
  isCacheCurrent,
  CACHE_VERSION,
  applyOverrides,
  loadOverrides,
} from './library.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

// --- ticket #12: songKey normalization (spec §2, ADR 0001) ---

test('normalizeSongField lowercases, trims, and collapses whitespace', () => {
  assert.equal(normalizeSongField('  Fleetwood   Mac '), 'fleetwood mac');
});

test('normalizeSongField strips punctuation', () => {
  assert.equal(normalizeSongField("Don't Stop"), 'dont stop');
  assert.equal(normalizeSongField('U & Ur Hand'), 'u ur hand');
});

test('normalizeSongField folds leading "The"', () => {
  assert.equal(normalizeSongField('The Cranberries'), normalizeSongField('Cranberries'));
});

test('normalizeSongField folds trailing ", The"', () => {
  assert.equal(normalizeSongField('Walk, The'), normalizeSongField('The Walk'));
});

test('makeSongKey joins normalized artist and title with a pipe', () => {
  const { songKey, versionLabel } = makeSongKey('Fleetwood Mac', 'Dreams');
  assert.equal(songKey, 'fleetwood mac|dreams');
  assert.equal(versionLabel, '');
});

test('makeSongKey groups the same song across formats (multi-disc case)', () => {
  const a = makeSongKey('Fleetwood Mac', 'Dreams');
  const b = makeSongKey('Fleetwood  Mac', "DREAMS");
  assert.equal(a.songKey, b.songKey);
});

test('makeSongKey strips a trailing parens suffix into versionLabel', () => {
  const { songKey, versionLabel } = makeSongKey('Pink', 'U + Ur Hand (Radio Version)');
  assert.equal(songKey, 'pink|u ur hand');
  assert.equal(versionLabel, 'Radio Version');
});

test('makeSongKey keeps non-trailing parens in the title', () => {
  const { songKey, versionLabel } = makeSongKey('Artist', '(I Just) Died In Your Arms');
  assert.equal(versionLabel, '');
  assert.equal(songKey, 'artist|i just died in your arms');
});

test('makeSongKey does not merge distinct songs', () => {
  const a = makeSongKey('Fleetwood Mac', 'Dreams');
  const b = makeSongKey('The Cranberries', 'Dreams');
  assert.notEqual(a.songKey, b.songKey);
});

// --- ticket #12: cache schema v2 ---

// --- ticket #13: overrides.json (spec §3) ---

function fakeSong(overrides = {}) {
  const base = {
    id: 'abc123def456',
    filename: 'DKM2014-02 - Wrong Artist - Wrong Title',
    artist: 'Wrong Artist',
    title: 'Wrong Title',
    discCode: 'DKM2014-02',
    songKey: 'wrong artist|wrong title',
    versionLabel: '',
  };
  return { ...base, ...overrides };
}

test('an override by file id replaces artist/title and regroups the songKey', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, {
    abc123def456: { artist: 'Fleetwood Mac', title: 'Dreams' },
  });
  assert.equal(songs[0].artist, 'Fleetwood Mac');
  assert.equal(songs[0].title, 'Dreams');
  assert.equal(songs[0].songKey, 'fleetwood mac|dreams');
});

test('an override by filename also matches', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, {
    'DKM2014-02 - Wrong Artist - Wrong Title': { artist: 'Fleetwood Mac', title: 'Dreams' },
  });
  assert.equal(songs[0].songKey, 'fleetwood mac|dreams');
});

test('an overridden title with a parens suffix still yields a versionLabel', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, {
    abc123def456: { artist: 'Fleetwood Mac', title: 'Dreams (Live)' },
  });
  assert.equal(songs[0].songKey, 'fleetwood mac|dreams');
  assert.equal(songs[0].versionLabel, 'Live');
});

test('songs without an override entry are untouched', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, { 'someone-else': { artist: 'X', title: 'Y' } });
  assert.equal(songs[0].artist, 'Wrong Artist');
  assert.equal(songs[0].songKey, 'wrong artist|wrong title');
});

test('empty overrides map is a no-op', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, {});
  assert.equal(songs[0].artist, 'Wrong Artist');
});

test('loadOverrides: missing file is a clean no-op (empty map)', async () => {
  const missing = path.join(os.tmpdir(), `no-such-overrides-${Date.now()}.json`);
  assert.deepEqual(await loadOverrides(missing), {});
});

test('loadOverrides: malformed JSON warns and returns an empty map', async () => {
  const bad = path.join(os.tmpdir(), `bad-overrides-${Date.now()}.json`);
  await fs.writeFile(bad, '{ not json', 'utf8');
  try {
    assert.deepEqual(await loadOverrides(bad), {});
  } finally {
    await fs.rm(bad, { force: true });
  }
});

test('loadOverrides: valid file round-trips', async () => {
  const good = path.join(os.tmpdir(), `good-overrides-${Date.now()}.json`);
  await fs.writeFile(good, JSON.stringify({ id1: { artist: 'A', title: 'T' } }), 'utf8');
  try {
    assert.deepEqual(await loadOverrides(good), { id1: { artist: 'A', title: 'T' } });
  } finally {
    await fs.rm(good, { force: true });
  }
});

test('isCacheCurrent accepts only the current version with a songs array', () => {
  assert.equal(isCacheCurrent({ version: CACHE_VERSION, songs: [] }), true);
  assert.equal(isCacheCurrent({ version: 1, songs: [] }), false);
  assert.equal(isCacheCurrent({ songs: [] }), false); // unversioned v1 cache
  assert.equal(isCacheCurrent({ version: CACHE_VERSION }), false);
  assert.equal(isCacheCurrent(null), false);
});
