import fs from 'node:fs';
import path from 'node:path';

const cachePath = path.resolve(import.meta.dirname, '../karaoke-app/library-cache.json');
const songs = JSON.parse(fs.readFileSync(cachePath, 'utf8')).songs;

function normalizeSongField(field) {
  return String(field ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the /, '')
    .replace(/, the$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(title) {
  const value = String(title ?? '');
  const parensSuffix = value.match(/^(.*\S)\s*\(([^)]+)\)$/);
  return parensSuffix ? parensSuffix[1] : value;
}

function dropAndTokens(normalized) {
  return normalized.split(' ').filter(token => token && token !== 'and').join(' ');
}

function proposedArtistParts(artist) {
  const normalized = normalizeSongField(artist);
  const stripped = normalized.replace(/\b(feat|featuring|ft|with|duet)\b.*$/, '').trim();
  const noAnd = dropAndTokens(stripped);
  const sorted = noAnd.split(' ').filter(Boolean).sort((a, b) => a.localeCompare(b)).join(' ');
  return { normalized, stripped, noAnd, sorted };
}

function currentArtistKey(song) {
  return normalizeSongField(song.artist);
}

function currentTitleKey(song) {
  return normalizeSongField(baseTitle(song.title));
}

function proposedTitleKey(song) {
  return dropAndTokens(currentTitleKey(song));
}

function currentGroupingKey(song) {
  return `${currentArtistKey(song)}|${currentTitleKey(song)}`;
}

function proposedGroupingKey(song) {
  if (!song.artist || !String(song.artist).trim()) {
    return `filename|${String(song.filename ?? '').toLowerCase()}`;
  }
  return `${proposedArtistParts(song.artist).sorted}|${proposedTitleKey(song)}`;
}

function example(song) {
  return `${song.artist || '[blank]'} - ${song.title || '[blank]'} (${song.discCode || '[blank]'})`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const nonBlank = songs.filter(song => song.artist && String(song.artist).trim());

const emptyArtistKeySongs = nonBlank.filter(song => proposedArtistParts(song.artist).sorted === '');
const emptyArtistKeyDistinctArtists = uniqueBy(emptyArtistKeySongs, song => song.artist);

const keywordChangedSongs = nonBlank.filter(song => {
  const parts = proposedArtistParts(song.artist);
  return /\b(feat|featuring|ft|with|duet)\b/.test(parts.normalized) && parts.stripped !== parts.normalized;
});
const keywordChangedDistinctArtists = uniqueBy(keywordChangedSongs, song => song.artist);
const withDuetNotFeatSongs = keywordChangedSongs.filter(song => {
  const normalized = proposedArtistParts(song.artist).normalized;
  return /\b(with|duet)\b/.test(normalized) && !/\b(feat|featuring|ft)\b/.test(normalized);
});
const withDuetNotFeatArtists = uniqueBy(withDuetNotFeatSongs, song => song.artist);
const beginsKeywordSongs = keywordChangedSongs.filter(song =>
  /^(feat|featuring|ft|with|duet)\b/.test(proposedArtistParts(song.artist).normalized)
);

const substringOnlyArtists = uniqueBy(nonBlank.filter(song => {
  const normalized = proposedArtistParts(song.artist).normalized;
  return /(feat|featuring|ft|with|duet)/.test(normalized) && !/\b(feat|featuring|ft|with|duet)\b/.test(normalized);
}), song => song.artist);

const proposedGroups = groupBy(nonBlank, proposedGroupingKey);
const collisionGroups = [];
for (const [key, group] of proposedGroups) {
  const currentKeys = new Set(group.map(currentGroupingKey));
  const currentArtists = new Set(group.map(currentArtistKey));
  if (currentKeys.size <= 1 || currentArtists.size <= 1) continue;
  const unsortedArtistKeys = new Set(group.map(song => proposedArtistParts(song.artist).noAnd));
  const sortedArtistKeys = new Set(group.map(song => proposedArtistParts(song.artist).sorted));
  collisionGroups.push({
    key,
    songs: group,
    currentKeyCount: currentKeys.size,
    currentArtistCount: currentArtists.size,
    unsortedArtistKeyCount: unsortedArtistKeys.size,
    sortedArtistKeyCount: sortedArtistKeys.size,
  });
}
collisionGroups.sort((a, b) => b.currentKeyCount - a.currentKeyCount || b.songs.length - a.songs.length || a.key.localeCompare(b.key));
const sortedOnlyCollisionGroups = collisionGroups.filter(group =>
  group.sortedArtistKeyCount === 1 && group.unsortedArtistKeyCount > 1
);

const sortChangedSongs = nonBlank.filter(song => {
  const parts = proposedArtistParts(song.artist);
  return parts.noAnd && parts.noAnd !== parts.sorted;
});
const singleLetterSongs = nonBlank.filter(song =>
  proposedArtistParts(song.artist).normalized.split(' ').some(token => /^[a-z]$/.test(token))
);
const numericSongs = nonBlank.filter(song =>
  proposedArtistParts(song.artist).normalized.split(' ').some(token => /^\d+$/.test(token))
);
const longArtistSongs = nonBlank.filter(song =>
  proposedArtistParts(song.artist).normalized.split(' ').filter(Boolean).length >= 6
);

const titleAndGroups = [];
for (const [key, group] of groupBy(nonBlank, song => `${currentArtistKey(song)}|${proposedTitleKey(song)}`)) {
  const currentTitles = new Set(group.map(currentTitleKey));
  const currentKeys = new Set(group.map(currentGroupingKey));
  if (currentTitles.size <= 1 || currentKeys.size <= 1) continue;
  titleAndGroups.push({ key, songs: group, currentTitleCount: currentTitles.size });
}
titleAndGroups.sort((a, b) => b.currentTitleCount - a.currentTitleCount || b.songs.length - a.songs.length || a.key.localeCompare(b.key));

const exactPresenceAbsenceTitleAndGroups = titleAndGroups.filter(({ songs: group }) => {
  const titles = [...new Set(group.map(currentTitleKey))];
  return titles.some(title => title.split(' ').includes('and')) && titles.some(title => !title.split(' ').includes('and'));
});

function summarizeGroup(group) {
  return {
    key: group.key,
    songCount: group.songs.length,
    currentKeyCount: group.currentKeyCount,
    currentArtistCount: group.currentArtistCount,
    unsortedArtistKeyCount: group.unsortedArtistKeyCount,
    examples: uniqueBy(group.songs, song => currentGroupingKey(song)).slice(0, 6).map(song => ({
      example: example(song),
      currentKey: currentGroupingKey(song),
      proposedArtist: proposedArtistParts(song.artist).sorted,
      proposedTitle: proposedTitleKey(song),
    })),
  };
}

function summarizeTitleGroup(group) {
  return {
    key: group.key,
    songCount: group.songs.length,
    currentTitleCount: group.currentTitleCount,
    examples: uniqueBy(group.songs, song => currentGroupingKey(song)).slice(0, 6).map(song => ({
      example: example(song),
      currentTitle: currentTitleKey(song),
      proposedTitle: proposedTitleKey(song),
    })),
  };
}

const report = {
  songCount: songs.length,
  nonBlankArtistSongCount: nonBlank.length,
  emptyArtistKey: {
    songCount: emptyArtistKeySongs.length,
    distinctArtistCount: emptyArtistKeyDistinctArtists.length,
    examples: emptyArtistKeySongs.map(example),
  },
  keywordStrip: {
    changedSongCount: keywordChangedSongs.length,
    changedDistinctArtistCount: keywordChangedDistinctArtists.length,
    withOrDuetNoFeatSongCount: withDuetNotFeatSongs.length,
    withOrDuetNoFeatDistinctArtistCount: withDuetNotFeatArtists.length,
    beginsKeywordSongCount: beginsKeywordSongs.length,
    substringOnlyDistinctArtistCount: substringOnlyArtists.length,
    withOrDuetNoFeatExamples: uniqueBy(withDuetNotFeatSongs, song => `${song.artist}|${song.title}|${song.discCode}`).slice(0, 30).map(song => ({
      example: example(song),
      normalized: proposedArtistParts(song.artist).normalized,
      stripped: proposedArtistParts(song.artist).stripped,
    })),
    substringOnlyExamples: substringOnlyArtists.slice(0, 30).map(song => ({
      example: example(song),
      normalized: proposedArtistParts(song.artist).normalized,
    })),
  },
  proposedArtistTitleCollisions: {
    groupCount: collisionGroups.length,
    sortedTokenSpecificGroupCount: sortedOnlyCollisionGroups.length,
    topGroups: collisionGroups.slice(0, 30).map(summarizeGroup),
    sortedTokenSpecificGroups: sortedOnlyCollisionGroups.slice(0, 30).map(summarizeGroup),
  },
  tokenPathologies: {
    sortChangedSongCount: sortChangedSongs.length,
    sortChangedDistinctArtistCount: uniqueBy(sortChangedSongs, song => song.artist).length,
    singleLetterSongCount: singleLetterSongs.length,
    singleLetterDistinctArtistCount: uniqueBy(singleLetterSongs, song => song.artist).length,
    numericSongCount: numericSongs.length,
    numericDistinctArtistCount: uniqueBy(numericSongs, song => song.artist).length,
    longArtistSongCount: longArtistSongs.length,
    longArtistDistinctArtistCount: uniqueBy(longArtistSongs, song => song.artist).length,
    sortChangedExamples: uniqueBy(sortChangedSongs, song => song.artist).slice(0, 15).map(song => {
      const parts = proposedArtistParts(song.artist);
      return `${example(song)} :: ${parts.noAnd} -> ${parts.sorted}`;
    }),
    singleLetterExamples: uniqueBy(singleLetterSongs, song => song.artist).slice(0, 15).map(example),
    numericExamples: uniqueBy(numericSongs, song => song.artist).slice(0, 15).map(example),
    longArtistExamples: uniqueBy(longArtistSongs, song => song.artist).slice(0, 15).map(song => {
      const parts = proposedArtistParts(song.artist);
      return `${example(song)} :: ${parts.normalized} -> ${parts.sorted}`;
    }),
  },
  titleAndCollisions: {
    groupCount: titleAndGroups.length,
    exactPresenceAbsenceGroupCount: exactPresenceAbsenceTitleAndGroups.length,
    topGroups: titleAndGroups.slice(0, 50).map(summarizeTitleGroup),
    exactPresenceAbsenceTopGroups: exactPresenceAbsenceTitleAndGroups.slice(0, 50).map(summarizeTitleGroup),
  },
};

console.log(JSON.stringify(report, null, 2));
