import fs from 'node:fs';
import path from 'node:path';

const songs = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../karaoke-app/library-cache.json'), 'utf8')).songs;

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

function dropAndTokens(value) {
  return value.split(' ').filter(token => token && token !== 'and').join(' ');
}

function proposedArtistParts(artist) {
  const normalized = normalizeSongField(artist);
  const stripped = normalized.replace(/\b(feat|featuring|ft|with|duet)\b.*$/, '').trim();
  const noAnd = dropAndTokens(stripped);
  const sorted = noAnd.split(' ').filter(Boolean).sort((a, b) => a.localeCompare(b)).join(' ');
  return { normalized, stripped, noAnd, sorted };
}

function currentTitleKey(song) {
  return normalizeSongField(baseTitle(song.title));
}

function proposedTitleKey(song) {
  return dropAndTokens(currentTitleKey(song));
}

function proposedKey(song) {
  if (!song.artist || !String(song.artist).trim()) return `filename|${String(song.filename ?? '').toLowerCase()}`;
  return `${proposedArtistParts(song.artist).sorted}|${proposedTitleKey(song)}`;
}

function currentKey(song) {
  if (!song.artist || !String(song.artist).trim()) return `filename|${String(song.filename ?? '').toLowerCase()}`;
  return `${normalizeSongField(song.artist)}|${currentTitleKey(song)}`;
}

function example(song) {
  return `${song.artist || '[blank]'} - ${song.title || '[blank]'} (${song.discCode || '[blank]'})`;
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

function unique(items, keyFn) {
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

const nonBlank = songs.filter(song => song.artist && String(song.artist).trim());
const groups = [...groupBy(nonBlank, proposedKey).entries()].map(([key, group]) => ({ key, group }));

const emptyArtistMergeGroups = groups.filter(({ key, group }) =>
  key.startsWith('|') && new Set(group.map(currentKey)).size > 1
);

const keywordStripMergeGroups = groups.filter(({ group }) =>
  group.some(song => {
    const parts = proposedArtistParts(song.artist);
    return parts.stripped !== parts.normalized;
  }) && new Set(group.map(currentKey)).size > 1
);

const titleLeadingAndGroups = [];
for (const [key, group] of groupBy(nonBlank, song => `${normalizeSongField(song.artist)}|${proposedTitleKey(song)}`)) {
  const titles = [...new Set(group.map(currentTitleKey))];
  if (titles.length > 1 && titles.some(title => title.startsWith('and ')) && titles.some(title => !title.startsWith('and '))) {
    titleLeadingAndGroups.push({ key, group });
  }
}

const titleInternalAndNoAmpGroups = [];
for (const [key, group] of groupBy(nonBlank, song => `${normalizeSongField(song.artist)}|${proposedTitleKey(song)}`)) {
  const titles = [...new Set(group.map(currentTitleKey))];
  const hasAnd = titles.some(title => title.split(' ').includes('and'));
  const hasNoAnd = titles.some(title => !title.split(' ').includes('and'));
  const rawHasAmp = group.some(song => String(song.title).includes('&'));
  if (titles.length > 1 && hasAnd && hasNoAnd && !rawHasAmp) {
    titleInternalAndNoAmpGroups.push({ key, group });
  }
}

function summarizeGroups(groupList, limit = 20) {
  return groupList.slice(0, limit).map(({ key, group }) => ({
    key,
    songCount: group.length,
    currentKeyCount: new Set(group.map(currentKey)).size,
    examples: unique(group, currentKey).slice(0, 6).map(song => ({
      example: example(song),
      currentKey: currentKey(song),
      proposedKey: proposedKey(song),
      artistTransform: `${proposedArtistParts(song.artist).normalized} -> ${proposedArtistParts(song.artist).sorted}`,
      titleTransform: `${currentTitleKey(song)} -> ${proposedTitleKey(song)}`,
    })),
  }));
}

const report = {
  emptyArtistMergeGroups: {
    groupCount: emptyArtistMergeGroups.length,
    groups: summarizeGroups(emptyArtistMergeGroups),
  },
  keywordStripMergeGroups: {
    groupCount: keywordStripMergeGroups.length,
    groups: summarizeGroups(keywordStripMergeGroups, 50),
  },
  titleLeadingAndGroups: {
    groupCount: titleLeadingAndGroups.length,
    groups: summarizeGroups(titleLeadingAndGroups, 20),
  },
  titleInternalAndNoAmpGroups: {
    groupCount: titleInternalAndNoAmpGroups.length,
    groups: summarizeGroups(titleInternalAndNoAmpGroups, 20),
  },
};

console.log(JSON.stringify(report, null, 2));
