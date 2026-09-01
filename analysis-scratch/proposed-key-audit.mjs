import fs from 'node:fs';
import path from 'node:path';

const cachePath = path.resolve(import.meta.dirname, '../karaoke-app/library-cache.json');
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const songs = cache.songs;

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

function proposedTitleKey(title) {
  return dropAndTokens(normalizeSongField(baseTitle(title)));
}

function currentTitleKey(title) {
  return normalizeSongField(baseTitle(title));
}

function currentArtistKey(artist) {
  return normalizeSongField(artist);
}

function proposedGroupingKey(song) {
  const hasArtist = song.artist && String(song.artist).trim();
  if (!hasArtist) return `filename|${String(song.filename ?? '').toLowerCase()}`;
  return `${proposedArtistParts(song.artist).sorted}|${proposedTitleKey(song.title)}`;
}

function currentGroupingKey(song) {
  const hasArtist = song.artist && String(song.artist).trim();
  if (!hasArtist) return `filename|${String(song.filename ?? '').toLowerCase()}`;
  return `${currentArtistKey(song.artist)}|${currentTitleKey(song.title)}`;
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

function tokenCount(artist) {
  return proposedArtistParts(artist).normalized.split(' ').filter(Boolean).length;
}

const nonBlankArtistSongs = songs.filter(song => song.artist && String(song.artist).trim());

const emptyArtistKeySongs = nonBlankArtistSongs.filter(song => proposedArtistParts(song.artist).sorted === '');
const emptyArtistKeyArtists = uniqueBy(emptyArtistKeySongs, song => song.artist);

const keywordRegex = /\b(feat|featuring|ft|with|duet)\b/;
const keywordChangedSongs = nonBlankArtistSongs.filter(song => {
  const parts = proposedArtistParts(song.artist);
  return keywordRegex.test(parts.normalized) && parts.stripped !== parts.normalized;
});
const keywordChangedArtists = uniqueBy(keywordChangedSongs, song => song.artist)
  .map(song => ({
    artist: song.artist,
    normalized: proposedArtistParts(song.artist).normalized,
    stripped: proposedArtistParts(song.artist).stripped,
    count: keywordChangedSongs.filter(s => s.artist === song.artist).length,
    examples: keywordChangedSongs.filter(s => s.artist === song.artist).slice(0, 3).map(example),
  }))
  .sort((a, b) => a.normalized.localeCompare(b.normalized));

const substringKeywordArtists = uniqueBy(nonBlankArtistSongs.filter(song => {
  const normalized = proposedArtistParts(song.artist).normalized;
  return /(feat|featuring|ft|with|duet)/.test(normalized) && !keywordRegex.test(normalized);
}), song => song.artist)
  .map(song => ({
    artist: song.artist,
    normalized: proposedArtistParts(song.artist).normalized,
    count: nonBlankArtistSongs.filter(s => s.artist === song.artist).length,
    examples: nonBlankArtistSongs.filter(s => s.artist === song.artist).slice(0, 3).map(example),
  }))
  .sort((a, b) => a.normalized.localeCompare(b.normalized));

const byProposed = new Map();
for (const song of nonBlankArtistSongs) {
  const key = proposedGroupingKey(song);
  if (!byProposed.has(key)) byProposed.set(key, []);
  byProposed.get(key).push(song);
}

const proposedCollisionGroups = [];
for (const [key, groupSongs] of byProposed) {
  const currentKeys = new Set(groupSongs.map(currentGroupingKey));
  const artistKeys = new Set(groupSongs.map(song => currentArtistKey(song.artist)));
  const titleKeys = new Set(groupSongs.map(song => currentTitleKey(song.title)));
  if (currentKeys.size > 1 && artistKeys.size > 1 && titleKeys.size >= 1) {
    proposedCollisionGroups.push({
      key,
      count: groupSongs.length,
      distinctCurrentKeys: currentKeys.size,
      distinctCurrentArtists: artistKeys.size,
      distinctCurrentTitles: titleKeys.size,
      examples: uniqueBy(groupSongs, song => `${currentArtistKey(song.artist)}|${song.discCode}`).slice(0, 8).map(example),
      artistVariants: [...new Set(groupSongs.map(song => `${song.artist} -> ${proposedArtistParts(song.artist).sorted}`))],
      titleVariants: [...new Set(groupSongs.map(song => `${song.title} -> ${proposedTitleKey(song.title)}`))],
    });
  }
}
proposedCollisionGroups.sort((a, b) => b.distinctCurrentKeys - a.distinctCurrentKeys || b.count - a.count || a.key.localeCompare(b.key));

const sortedTokenCollisionGroups = proposedCollisionGroups.filter(group => {
  const beforeSortKeys = new Set(group.examples.map(() => ''));
  const members = byProposed.get(group.key);
  const unsortedArtistKeys = new Set(members.map(song => proposedArtistParts(song.artist).noAnd));
  const sortedArtistKeys = new Set(members.map(song => proposedArtistParts(song.artist).sorted));
  return sortedArtistKeys.size === 1 && unsortedArtistKeys.size > 1;
});

const singleLetterTokenSongs = nonBlankArtistSongs.filter(song =>
  proposedArtistParts(song.artist).normalized.split(' ').some(token => /^[a-z]$/.test(token))
);
const numericTokenSongs = nonBlankArtistSongs.filter(song =>
  proposedArtistParts(song.artist).normalized.split(' ').some(token => /^\d+$/.test(token))
);
const longArtistSongs = nonBlankArtistSongs.filter(song => tokenCount(song.artist) >= 6);
const sortChangedSongs = nonBlankArtistSongs.filter(song => {
  const parts = proposedArtistParts(song.artist);
  return parts.noAnd && parts.noAnd !== parts.sorted;
});

const titleByDroppedAnd = new Map();
for (const song of nonBlankArtistSongs) {
  const titleNoAnd = proposedTitleKey(song.title);
  if (!titleNoAnd) continue;
  const artist = currentArtistKey(song.artist);
  const key = `${artist}|${titleNoAnd}`;
  if (!titleByDroppedAnd.has(key)) titleByDroppedAnd.set(key, []);
  titleByDroppedAnd.get(key).push(song);
}

const titleAndCollisionGroups = [];
for (const [key, groupSongs] of titleByDroppedAnd) {
  const currentTitles = new Set(groupSongs.map(song => currentTitleKey(song.title)));
  const currentKeys = new Set(groupSongs.map(currentGroupingKey));
  if (currentTitles.size > 1 && currentKeys.size > 1) {
    titleAndCollisionGroups.push({
      key,
      count: groupSongs.length,
      distinctCurrentTitles: currentTitles.size,
      examples: uniqueBy(groupSongs, song => `${currentTitleKey(song.title)}|${song.discCode}`).slice(0, 8).map(example),
      titleVariants: [...new Set(groupSongs.map(song => `${song.title} -> ${currentTitleKey(song.title)} -> ${proposedTitleKey(song.title)}`))],
    });
  }
}
titleAndCollisionGroups.sort((a, b) => b.distinctCurrentTitles - a.distinctCurrentTitles || b.count - a.count || a.key.localeCompare(b.key));

const exactTitleAndCollisionGroups = titleAndCollisionGroups.filter(group => {
  const titles = group.titleVariants.map(v => v.split(' -> ')[1]);
  return titles.some(title => title.split(' ').includes('and')) && titles.some(title => !title.split(' ').includes('and'));
});

const summary = {
  cachePath,
  songCount: songs.length,
  nonBlankArtistSongCount: nonBlankArtistSongs.length,
  emptyArtistKey: {
    songCount: emptyArtistKeySongs.length,
    distinctArtistCount: emptyArtistKeyArtists.length,
    examples: emptyArtistKeySongs.slice(0, 25).map(example),
    artists: emptyArtistKeyArtists.slice(0, 50).map(song => song.artist),
  },
  featKeywordChanged: {
    songCount: keywordChangedSongs.length,
    distinctArtistCount: keywordChangedArtists.length,
    artists: keywordChangedArtists,
  },
  substringKeywordNoRegexChange: {
    distinctArtistCount: substringKeywordArtists.length,
    artists: substringKeywordArtists.slice(0, 100),
  },
  proposedCollisions: {
    groupCount: proposedCollisionGroups.length,
    sortedTokenSpecificGroupCount: sortedTokenCollisionGroups.length,
    topGroups: proposedCollisionGroups.slice(0, 100),
    sortedTokenSpecificTopGroups: sortedTokenCollisionGroups.slice(0, 100),
  },
  tokenPathologies: {
    singleLetterToken: {
      songCount: singleLetterTokenSongs.length,
      distinctArtistCount: uniqueBy(singleLetterTokenSongs, song => song.artist).length,
      examples: uniqueBy(singleLetterTokenSongs, song => song.artist).slice(0, 30).map(example),
    },
    numericToken: {
      songCount: numericTokenSongs.length,
      distinctArtistCount: uniqueBy(numericTokenSongs, song => song.artist).length,
      examples: uniqueBy(numericTokenSongs, song => song.artist).slice(0, 30).map(example),
    },
    longArtistName: {
      songCount: longArtistSongs.length,
      distinctArtistCount: uniqueBy(longArtistSongs, song => song.artist).length,
      examples: uniqueBy(longArtistSongs, song => song.artist).slice(0, 30).map(example),
    },
    sortChangesArtist: {
      songCount: sortChangedSongs.length,
      distinctArtistCount: uniqueBy(sortChangedSongs, song => song.artist).length,
      examples: uniqueBy(sortChangedSongs, song => song.artist).slice(0, 30).map(song => {
        const parts = proposedArtistParts(song.artist);
        return `${example(song)} :: ${parts.noAnd} -> ${parts.sorted}`;
      }),
    },
  },
  titleAndCollisions: {
    groupCount: titleAndCollisionGroups.length,
    exactPresenceAbsenceGroupCount: exactTitleAndCollisionGroups.length,
    topGroups: titleAndCollisionGroups.slice(0, 100),
    exactPresenceAbsenceTopGroups: exactTitleAndCollisionGroups.slice(0, 100),
  },
};

console.log(JSON.stringify(summary, null, 2));
