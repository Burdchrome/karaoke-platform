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
  groupSongs,
  buildIndex,
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
});

// #23: "&", "And", and nothing all agree — "Simon & Garfunkel", "Simon And
// Garfunkel", and "Simon Garfunkel" are the same artist in this library.
// Every title pair differing only by "and" was human-screened as the same
// song before this fold was allowed (issue #23).
test('normalizeSongField ignores "&" and "and" alike', () => {
  assert.equal(normalizeSongField('U & Ur Hand'), 'u ur hand');
  assert.equal(normalizeSongField('U And Ur Hand'), 'u ur hand');
  assert.equal(normalizeSongField('Simon & Garfunkel'), normalizeSongField('Simon And Garfunkel'));
  assert.equal(normalizeSongField('All That Jazz'), normalizeSongField('And All That Jazz'));
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

// #23: the artist half of the key is word-order-insensitive, so the same
// artist written "Last, First" on one disc pack and "First Last" on another
// lands in one group. Titles keep their word order — "Piano Man" is not
// "Man Piano".
test('makeSongKey groups artist name-order variants (#23)', () => {
  assert.equal(
    makeSongKey('Puckett, Gary & The Union Gap', 'Over You').songKey,
    makeSongKey('Gary Puckett & The Union Gap', 'Over You').songKey,
  );
  assert.equal(
    makeSongKey('White Bryan', 'Look At Me Now').songKey,
    makeSongKey('Bryan White', 'Look At Me Now').songKey,
  );
  assert.equal(
    makeSongKey('Ross, Diana & Lionel Richie', 'Endless Love').songKey,
    makeSongKey('Lionel Richie & Diana Ross', 'Endless Love').songKey,
  );
  // Anti-split guard: files that omit the "&" entirely must stay grouped
  // with their punctuated twins (37 real cases in the cache).
  assert.equal(
    makeSongKey('Peter, Paul & Mary', 'Puff The Magic Dragon').songKey,
    makeSongKey('Peter Paul Mary', 'Puff The Magic Dragon').songKey,
  );
});

test('makeSongKey keeps title word order significant (#23)', () => {
  assert.notEqual(
    makeSongKey('Artist', 'Piano Man').songKey,
    makeSongKey('Artist', 'Man Piano').songKey,
  );
});

test('makeSongKey does not merge distinct songs', () => {
  const a = makeSongKey('Fleetwood Mac', 'Dreams');
  const b = makeSongKey('The Cranberries', 'Dreams');
  assert.notEqual(a.songKey, b.songKey);
});

// --- ticket #12: cache schema v2 ---

// --- ticket #13: overrides.json (spec §3) ---

function fakeSong(fields = {}) {
  const base = {
    id: 'abc123def456',
    filename: 'DKM2014-02 - Wrong Artist - Wrong Title',
    artist: 'Wrong Artist',
    title: 'Wrong Title',
    discCode: 'DKM2014-02',
    songKey: 'wrong artist|wrong title',
    versionLabel: '',
  };
  return { ...base, ...fields };
}

test('a malformed override entry (missing title) is skipped, not crashed on', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, { abc123def456: { artist: 'Fleetwood Mac' } });
  assert.equal(songs[0].artist, 'Wrong Artist');
  assert.equal(songs[0].songKey, 'wrong artist|wrong title');
});

test('a string-valued override entry is skipped, not crashed on', () => {
  const songs = [fakeSong()];
  applyOverrides(songs, { abc123def456: 'Fleetwood Mac - Dreams' });
  assert.equal(songs[0].artist, 'Wrong Artist');
});

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

// --- overrides × grouping: the seam the #30 promotions depend on ---
// applyOverrides and groupSongs are each tested above/below in isolation;
// these pin what the two do TOGETHER, because that is where a bad override
// would show up as a duplicate entry or a wrongly merged song.

// A parser failure: blank artist, filename-as-title, so groupSongs keys it
// on its filename and it floats as an orphan group.
function orphan(filename, discCode = '') {
  return fakeSong({
    id: `orphan-${filename.toLowerCase().replace(/\W+/g, '-')}-${discCode || 'nodisc'}`,
    filename,
    artist: '',
    title: filename,
    discCode,
    songKey: `|${filename.toLowerCase()}`,
  });
}

test('an override moves an orphan INTO the existing group, not beside it', () => {
  const songs = [
    fakeSong({ id: 'nd-1', filename: 'SC8000-01 - Neil Diamond - Red, Red Wine', artist: 'Neil Diamond', title: 'Red, Red Wine', discCode: 'SC8000-01', songKey: 'diamond neil|red red wine' }),
    orphan('Red Red Wine', 'DK100-05'),
  ];
  assert.equal(groupSongs(songs).length, 2, 'before: named song + orphan are separate groups');

  applyOverrides(songs, { 'Red Red Wine': { artist: 'Neil Diamond', title: 'Red, Red Wine' } });
  const groups = groupSongs(songs);
  assert.equal(groups.length, 1, 'after: the orphan joined the named group');
  assert.equal(groups[0].artist, 'Neil Diamond');
  assert.deepEqual(groups[0].versions.map((v) => v.discCode), ['DK100-05', 'SC8000-01']);
});

test('one filename-keyed override reaches every copy and yields ONE group', () => {
  // The drive has folders copied around: the same file under three disc codes.
  const songs = [orphan('Technologic', 'G13974'), orphan('Technologic', 'G22001'), orphan('Technologic', 'SF900-07')];
  assert.equal(groupSongs(songs).length, 1, 'orphans sharing a filename already collapse on filename');

  applyOverrides(songs, { Technologic: { artist: 'Daft Punk', title: 'Technologic' } });
  const groups = groupSongs(songs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].artist, 'Daft Punk');
  assert.equal(groups[0].versions.length, 3, 'all three copies applied, none dropped, none duplicated');
});

test('an override never merges two different songs that share a title', () => {
  const songs = [
    fakeSong({ id: 'q-1', filename: 'Queen - Delilah', artist: 'Queen', title: 'Delilah', discCode: 'SC1', songKey: 'queen|delilah' }),
    orphan('delilah', 'DK72-09'),
  ];
  applyOverrides(songs, { delilah: { artist: 'Tom Jones', title: 'Delilah' } });
  const groups = groupSongs(songs);
  assert.equal(groups.length, 2, 'Tom Jones and Queen stay separate');
  assert.deepEqual(groups.map((g) => g.artist).sort(), ['Queen', 'Tom Jones']);
});

test('applying overrides twice is the same as applying once', () => {
  const overrides = { 'Red Red Wine': { artist: 'Neil Diamond', title: 'Red, Red Wine (Live)' } };
  const once = applyOverrides([orphan('Red Red Wine', 'DK1')], overrides);
  const twice = applyOverrides(applyOverrides([orphan('Red Red Wine', 'DK1')], overrides), overrides);
  assert.deepEqual(twice, once);
  assert.equal(once[0].versionLabel, 'Live', 'versionLabel is recomputed from the override, not stacked');
});

test('invariant: applying overrides never increases the group count', () => {
  // An override can only move a file from "keyed on its own filename" to a
  // real song key — so groups can merge, never split. If this ever fails,
  // the key derivation or the override format changed underneath us.
  const songs = [
    fakeSong({ id: 'a', filename: 'A', artist: 'Garth Brooks', title: 'The Dance', discCode: 'S1', songKey: 'brooks garth|dance' }),
    fakeSong({ id: 'b', filename: 'B', artist: 'Garth Brooks', title: 'That Summer', discCode: 'S2', songKey: 'brooks garth|that summer' }),
    orphan('The Dance', 'D1'),
    orphan('That Summer', 'D2'),
    orphan('unmatched file', 'D3'),
    orphan("it's your song", 'D4'),
  ];
  const before = groupSongs(structuredClone(songs)).length;
  applyOverrides(songs, {
    'The Dance': { artist: 'Garth Brooks', title: 'Dance, The' },
    'That Summer': { artist: 'Garth Brooks', title: 'That Summer' },
    "it's your song": { artist: 'Garth Brooks', title: "It's Your Song" },
  });
  const after = groupSongs(songs).length;
  assert.ok(after <= before, `groups went ${before} -> ${after}`);
  assert.equal(after, before - 2, 'two orphans merged into named groups, one became its own named group, one stayed orphan');
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

// --- trackNN parsing (post-#19 nitpick round) ---

test('code glued by bare space gets its separator ("sc8155-09 elvis…")', () => {
  const p = parseFilename('sc8155-09 elvis presley-cant help falling in love');
  assert.equal(p.discCode, 'sc8155-09');
  assert.equal(p.artist.toLowerCase(), 'elvis presley');
  assert.equal(p.title, 'cant help falling in love');
});

test('track token after a real disc code folds into the code', () => {
  const p = parseFilename('SC7534 - 01 - BJ Thomas - Raindrops Keep Falling On My Head');
  assert.equal(p.discCode, 'SC7534-01');
  assert.equal(p.artist, 'BJ Thomas');
  assert.equal(p.title, 'Raindrops Keep Falling On My Head');
});

test('bare leading track number is stripped and flagged order-suspect', () => {
  const p = parseFilename('01  Girl Happy - Elvis Presley');
  assert.equal(p.discCode, '');
  assert.equal(p.orderSuspect, true);
  assert.deepEqual([p.artist, p.title], ['Girl Happy', 'Elvis Presley']);
});

test('space-glued track after a bare disc code folds into the code', () => {
  const p = parseFilename("sc8190_-_01_turtles_-_she'd_rather_be_with_me");
  assert.equal(p.discCode, 'sc8190-01');
  assert.equal(p.artist, 'turtles');
  assert.equal(p.title, "she'd rather be with me");
});

test('dashed code prefix glued by spaces still rejoins ("SC-8807-01  …")', () => {
  const p = parseFilename("SC-8807-01  There's More To Me Than You - Jessica Andrews");
  assert.equal(p.discCode, 'SC-8807-01');
  assert.equal(p.orderSuspect, true); // frequency check settles the order
  assert.deepEqual([p.artist, p.title], ["There's More To Me Than You", 'Jessica Andrews']);
});

test('pure-digit middle folds into the disc code (backtracked track)', () => {
  // glued-blob tail: no artist to extract — clean failure, code kept
  const blob = parseFilename('SC7583-01 - Damn_I_Wish_I_Was_Your_Lover_Sophie_B_Hawkins.');
  assert.equal(blob.artist, '');
  assert.equal(blob.discCode, 'SC7583-01');
  // tail with its own dash: re-split recovers the artist
  const elvis = parseFilename('dw19_01 - Elvis- Here Come Santa Claus');
  assert.equal(elvis.artist, 'Elvis');
  assert.equal(elvis.title, 'Here Come Santa Claus');
  assert.equal(elvis.discCode, 'dw19-01');
});

test('numeric-prefix artist after a full code is NOT treated as a track', () => {
  const p = parseFilename('SC7205-08 - 4 Seasons - December, 1963 Oh, What A Night');
  assert.equal(p.artist, '4 Seasons');
  assert.equal(p.discCode, 'SC7205-08');
});

test('numeric-prefix artists are NOT mistaken for track numbers', () => {
  assert.equal(parseFilename('98 Degrees - Because Of You').artist, '98 Degrees');
  assert.equal(parseFilename('50 Cent - In Da Club').artist, '50 Cent');
  assert.equal(parseFilename('10cc - The Things We Do For Love').artist, '10cc');
});

test('buildIndex flips order-suspect files when the title is a known artist', () => {
  const dir = String.raw`E:\karaoke\pack`;
  const files = [];
  // three clean files establish "Elvis Presley" as a known artist
  for (const t of ['Hound Dog', 'Blue Suede Shoes', 'Suspicious Minds']) {
    files.push(path.join(dir, `SC1000-01 - Elvis Presley - ${t}.mp3`));
    files.push(path.join(dir, `SC1000-01 - Elvis Presley - ${t}.cdg`));
  }
  files.push(path.join(dir, '01  Girl Happy - Elvis Presley.mp3'));
  files.push(path.join(dir, '01  Girl Happy - Elvis Presley.cdg'));
  // control: suspect whose right side is NOT a known artist stays as parsed
  files.push(path.join(dir, '03 - Allan Sherman - Hello Muddah.mp3'));
  files.push(path.join(dir, '03 - Allan Sherman - Hello Muddah.cdg'));
  const songs = buildIndex(files);
  const flipped = songs.find(s => s.filename.includes('Girl Happy'));
  assert.equal(flipped.artist, 'Elvis Presley');
  assert.equal(flipped.title, 'Girl Happy');
  const control = songs.find(s => s.filename.includes('Allan Sherman'));
  assert.equal(control.artist, 'Allan Sherman');
});

// --- issue #25: Sunfly dashes-as-spaces dialect ---
// "01.-Lady-Gaga-Teeth-(SF314-01)": NN.- track prefix, dashes as spaces, disc
// code in trailing parens. parseFilename peels the fixed pieces and flags the
// file; buildIndex's library-frequency check does the artist/title split.

test('Sunfly dialect: track and paren code peel, dashes become spaces', () => {
  const p = parseFilename('01.-Lady-Gaga-Teeth-(SF314-01)');
  assert.equal(p.discCode, 'SF314-01');
  assert.equal(p.artist, '');
  assert.equal(p.title, 'Lady Gaga Teeth');
  assert.equal(p.splitPending, true);
});

test('Sunfly dialect: internal parens survive, only the trailing code peels', () => {
  const big = parseFilename("01.-Notorious-B.I.G.-Juicy-(It's-All-Good)-(SFDT-1394)");
  assert.equal(big.discCode, 'SFDT-1394');
  assert.equal(big.title, "Notorious B.I.G. Juicy (It's All Good)");
  const clean = parseFilename('05.-Nicki-Minaj-Starships-(Clean)-(SF314-05)');
  assert.equal(clean.discCode, 'SF314-05');
  assert.equal(clean.title, 'Nicki Minaj Starships (Clean)');
});

test('Sunfly dialect: longer disc codes with digits in the prefix parse too', () => {
  const p = parseFilename('01.-Christina-Aguilera-(Burlesque)-Bound-To-You-(SFKK057-04)');
  assert.equal(p.discCode, 'SFKK057-04');
  assert.equal(p.title, 'Christina Aguilera (Burlesque) Bound To You');
  // letter after the digits ("SF303V") is still a code, not a version label
  const v = parseFilename('04.-Rihanna-California-King-Bed-(SF303V-04)');
  assert.equal(v.discCode, 'SF303V-04');
  assert.equal(v.title, 'Rihanna California King Bed');
});

test('Sunfly dialect does not fire on spaced-dash or non-code-paren files', () => {
  // Spaced separators = a different dialect; existing passes own these.
  const spaced = parseFilename('07 - Elvis - I Gotta Know');
  assert.equal(spaced.artist, 'Elvis');
  assert.equal(spaced.splitPending, undefined);
  // A trailing parens that is not code-shaped (no digits) is a version label,
  // not a disc code — must fall through unchanged.
  const version = parseFilename('99.-Some-Blob-(Duet)');
  assert.equal(version.discCode, '');
  assert.equal(version.title, '99.-Some-Blob-(Duet)');
});

test('buildIndex splits a Sunfly blob on a known artist prefix', () => {
  const dir = String.raw`E:\karaoke\sunfly`;
  const files = [];
  for (const t of ['Poker Face', 'Bad Romance', 'Paparazzi']) {
    files.push(path.join(dir, `SC1000-01 - Lady Gaga - ${t}.mp3`));
    files.push(path.join(dir, `SC1000-01 - Lady Gaga - ${t}.cdg`));
  }
  files.push(path.join(dir, '01.-Lady-Gaga-Teeth-(SF314-01).mp3'));
  files.push(path.join(dir, '01.-Lady-Gaga-Teeth-(SF314-01).cdg'));
  const songs = buildIndex(files);
  const split = songs.find(s => s.discCode === 'SF314-01');
  assert.equal(split.artist, 'Lady Gaga');
  assert.equal(split.title, 'Teeth');
  assert.equal(split.songKey, makeSongKey('Lady Gaga', 'Teeth').songKey);
});

test('buildIndex extends a Sunfly split through duet/feat joiners', () => {
  const dir = String.raw`E:\karaoke\sunfly`;
  const files = [];
  const establish = (artist, titles) => {
    for (const t of titles) {
      files.push(path.join(dir, `SC1000-01 - ${artist} - ${t}.mp3`));
      files.push(path.join(dir, `SC1000-01 - ${artist} - ${t}.cdg`));
    }
  };
  establish('Brad Paisley', ['Mud On The Tires', 'Whiskey Lullaby', 'She Said Yes']);
  establish('Carrie Underwood', ['Before He Cheats', 'Jesus Take The Wheel', 'So Small']);
  establish('Calvin Harris', ['Feel So Close', 'Summer', 'Sweet Nothing']);
  // hyphenated library spelling must still anchor the de-dashed feat clause
  establish('Ne-Yo', ['So Sick']);
  files.push(path.join(dir, '03.-Brad-Paisley-and-Carrie-Underwood-Remind-Me-(SFDT-2436).mp3'));
  files.push(path.join(dir, '03.-Brad-Paisley-and-Carrie-Underwood-Remind-Me-(SFDT-2436).cdg'));
  files.push(path.join(dir, "02.-Calvin-Harris-Feat.-Ne-Yo-Let's-Go-(SF314-02).mp3"));
  files.push(path.join(dir, "02.-Calvin-Harris-Feat.-Ne-Yo-Let's-Go-(SF314-02).cdg"));
  const songs = buildIndex(files);
  const duet = songs.find(s => s.discCode === 'SFDT-2436');
  assert.equal(duet.artist, 'Brad Paisley and Carrie Underwood');
  assert.equal(duet.title, 'Remind Me');
  const feat = songs.find(s => s.discCode === 'SF314-02');
  assert.equal(feat.artist, 'Calvin Harris Feat. Ne Yo');
  assert.equal(feat.title, "Let's Go");
});

test('buildIndex leaves an unresolvable Sunfly blob unsplit but readable', () => {
  const dir = String.raw`E:\karaoke\sunfly`;
  const songs = buildIndex([
    path.join(dir, '11.-Goyte-Eyes-Wide-Open-(SF314-11).mp3'),
    path.join(dir, '11.-Goyte-Eyes-Wide-Open-(SF314-11).cdg'),
  ]);
  assert.equal(songs.length, 1);
  // No library evidence for any split: fail clean, keep the peeled code and
  // the space-normalized title so the file stays searchable.
  assert.equal(songs[0].artist, '');
  assert.equal(songs[0].title, 'Goyte Eyes Wide Open');
  assert.equal(songs[0].discCode, 'SF314-11');
});

// --- issue #19: AppleDouble sidecars must not become songs ---

test('buildIndex skips macOS AppleDouble ._ sidecar pairs', () => {
  const dir = String.raw`E:\karaoke\pack`;
  const songs = buildIndex([
    path.join(dir, 'Carrie Underwood - I Aint In Checotah Anymore - 28605.mp3'),
    path.join(dir, 'Carrie Underwood - I Aint In Checotah Anymore - 28605.cdg'),
    path.join(dir, '._Carrie Underwood - I Aint In Checotah Anymore - 28605.mp3'),
    path.join(dir, '._Carrie Underwood - I Aint In Checotah Anymore - 28605.cdg'),
  ]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0].artist, 'Carrie Underwood');
});

// --- ticket #14: serve-time grouping by songKey (spec §2) ---

// Build a song object shaped like the ones buildIndex/loadLibrary produce,
// deriving songKey/versionLabel the same way so the grouping tests exercise
// real keys rather than hand-written ones.
function songFor(artist, title, { id, discCode = '', filename } = {}) {
  const { songKey, versionLabel } = makeSongKey(artist, title);
  return {
    id: id || makeId(`${artist}-${title}-${discCode}`),
    filename: filename || `${discCode} - ${artist} - ${title}`,
    artist,
    title,
    discCode,
    songKey,
    versionLabel,
  };
}

// Tiny deterministic id stand-in for tests (library's makeId is not exported).
function makeId(seed) {
  return seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'id';
}

test('groupSongs collapses two versions of the same songKey into one group', () => {
  const groups = groupSongs([
    songFor('Fleetwood Mac', 'Dreams', { id: 'a', discCode: 'SC8199' }),
    songFor('Fleetwood Mac', 'Dreams', { id: 'b', discCode: 'DK067' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 2);
});

test('groupSongs merges "Cranberries" and "The Cranberries" into one group', () => {
  const groups = groupSongs([
    songFor('The Cranberries', 'Dreams', { id: 'a', discCode: 'SC0001' }),
    songFor('Cranberries', 'Dreams', { id: 'b', discCode: 'DK0002' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 2);
});

test('groupSongs surfaces per-version discCode and versionLabel', () => {
  const groups = groupSongs([
    songFor('Pink', 'U + Ur Hand', { id: 'a', discCode: 'SC1000' }),
    songFor('Pink', 'U + Ur Hand (Radio Version)', { id: 'b', discCode: 'DK2000' }),
  ]);
  assert.equal(groups.length, 1);
  const labels = groups[0].versions.map(v => v.versionLabel).sort();
  assert.deepEqual(labels, ['', 'Radio Version']);
  const discs = groups[0].versions.map(v => v.discCode).sort();
  assert.deepEqual(discs, ['DK2000', 'SC1000']);
});

test('groupSongs versions are sorted by discCode', () => {
  const groups = groupSongs([
    songFor('Adele', 'Hello', { id: 'a', discCode: 'ZZ999' }),
    songFor('Adele', 'Hello', { id: 'b', discCode: 'AA111' }),
  ]);
  assert.deepEqual(groups[0].versions.map(v => v.discCode), ['AA111', 'ZZ999']);
  // Representative fields come from the first (lowest-disc) version.
  assert.equal(groups[0].discCode, 'AA111');
  assert.equal(groups[0].id, 'b');
});

test('groupSongs does NOT collapse blank-artist songs that share a title', () => {
  // Both parsed to empty artist with the raw filename dumped as title.
  // Keying on songKey would merge them (same normalized "|<title>"); keying
  // on filename keeps unrelated songs apart — preserves pre-#14 behavior.
  const groups = groupSongs([
    { id: 'a', filename: 'MYSTERY 1', artist: '', title: 'Intro', discCode: '', songKey: makeSongKey('', 'Intro').songKey, versionLabel: '' },
    { id: 'b', filename: 'MYSTERY 2', artist: '', title: 'Intro', discCode: '', songKey: makeSongKey('', 'Intro').songKey, versionLabel: '' },
  ]);
  assert.equal(groups.length, 2);
});

// #24: the drive has whole folders copied around AND the same disc ripped
// into several packs under different filename spellings ("LG071-02 - Diana
// Ross & Lionel Richie" vs "LG071-02 - Ross, Diana & Lionel Richie"). Within
// a group, a disc-track code identifies the recording: versions sharing a
// non-blank discCode are the same track and must show as one version row.
// Blank-discCode versions can't make that claim — they collapse only on
// identical filename.
test('groupSongs collapses same-discCode copies, renamed or not (#24)', () => {
  const groups = groupSongs([
    songFor('Adele', 'Hello', { id: 'a', discCode: 'AA111-01', filename: 'AA111-01 - Adele - Hello' }),
    songFor('Adele', 'Hello', { id: 'b', discCode: 'AA111-01', filename: 'AA111-01 - Adkins, Adele - Hello' }),
    songFor('Adele', 'Hello', { id: 'c', discCode: 'ZZ999-05', filename: 'ZZ999-05 - Adele - Hello' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 2, 'same disc-track = same recording = one row');
  assert.deepEqual(groups[0].versions.map(v => v.discCode), ['AA111-01', 'ZZ999-05']);
});

test('groupSongs blank-discCode versions collapse only on identical filename (#24)', () => {
  const groups = groupSongs([
    songFor('Adele', 'Hello', { id: 'a', discCode: '', filename: 'Hello - Adele' }),
    songFor('Adele', 'Hello', { id: 'b', discCode: '', filename: 'HELLO - ADELE' }),
    songFor('Adele', 'Hello', { id: 'c', discCode: '', filename: 'Adele - Hello (rip 2)' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 2,
    'identical filenames collapse; a distinct blank-disc file stays its own row');
});

test('groupSongs copy collapse is case-insensitive and order-independent (#24)', () => {
  const a = songFor('Adele', 'Hello', { id: 'a', discCode: 'AA111', filename: 'AA111-01 - ADELE - HELLO' });
  const b = songFor('Adele', 'Hello', { id: 'b', discCode: 'AA111', filename: 'aa111-01 - Adele - Hello' });
  const g1 = groupSongs([a, b]);
  const g2 = groupSongs([b, a]);
  assert.equal(g1[0].versions.length, 1);
  assert.equal(g2[0].versions.length, 1);
  // Deterministic survivor regardless of input order (stable site ids).
  assert.equal(g1[0].versions[0].id, g2[0].versions[0].id);
});

test('groupSongs group collapsing to one unique file behaves as single-version (#24)', () => {
  // The live "Lionel Richie - Endless Love, 2 versions" case: same disc-track
  // ripped twice under different filename spellings must become a plain
  // single-version group (no dropdown on the site).
  const groups = groupSongs([
    songFor('Lionel Richie', 'Endless Love', { id: 'a', discCode: 'LG005-14', filename: 'LG005-14 - Richie, Lionel - Endless Love' }),
    songFor('Lionel Richie', 'Endless Love', { id: 'b', discCode: 'LG005-14', filename: 'LG005-14 - Lionel Richie - Endless Love' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 1);
});

test('groupSongs keeps the versionLabel on a single-version group', () => {
  // A solitary "(Radio Version)" rip must still expose its label so the
  // frontend can show it on the flat single-version row (review fix, #14).
  const groups = groupSongs([
    songFor('Pink', 'U + Ur Hand (Radio Version)', { id: 'a', discCode: 'SC1000' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].versions.length, 1);
  assert.equal(groups[0].versions[0].versionLabel, 'Radio Version');
});

test('groupSongs preserves every input id across the version lists', () => {
  const input = [
    songFor('Fleetwood Mac', 'Dreams', { id: 'a', discCode: 'SC8199' }),
    songFor('Fleetwood Mac', 'Dreams', { id: 'b', discCode: 'DK067' }),
    songFor('The Cranberries', 'Dreams', { id: 'c', discCode: 'SC0001' }),
  ];
  const groups = groupSongs(input);
  const idsOut = groups.flatMap(g => g.versions.map(v => v.id)).sort();
  assert.deepEqual(idsOut, ['a', 'b', 'c']);
});
