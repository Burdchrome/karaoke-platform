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

function artistKey(song) {
  return normalizeSongField(song.artist);
}

function titleKey(song) {
  return normalizeSongField(baseTitle(song.title));
}

function proposedTitleKey(song) {
  return dropAndTokens(titleKey(song));
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
const allGroups = [];
for (const [key, group] of groupBy(nonBlank, song => `${artistKey(song)}|${proposedTitleKey(song)}`)) {
  const titles = [...new Set(group.map(titleKey))];
  if (titles.length <= 1) continue;
  allGroups.push({ key, group, titles });
}

const allHaveAndPositionGroups = allGroups.filter(({ titles }) =>
  titles.every(title => title.split(' ').includes('and'))
);

const presenceAbsenceGroups = allGroups.filter(({ titles }) =>
  titles.some(title => title.split(' ').includes('and')) && titles.some(title => !title.split(' ').includes('and'))
);

const rawNoAmpGroups = presenceAbsenceGroups.filter(({ group }) =>
  !group.some(song => String(song.title).includes('&'))
);

const report = {
  allAndCollisionGroupCount: allGroups.length,
  presenceAbsenceGroupCount: presenceAbsenceGroups.length,
  allHaveAndPositionGroupCount: allHaveAndPositionGroups.length,
  rawNoAmpPresenceAbsenceGroupCount: rawNoAmpGroups.length,
  allHaveAndPositionGroups: allHaveAndPositionGroups.slice(0, 25).map(({ key, group, titles }) => ({
    key,
    titles,
    examples: unique(group, song => `${artistKey(song)}|${titleKey(song)}`).map(example),
  })),
  rawNoAmpPresenceAbsenceGroups: rawNoAmpGroups.slice(0, 25).map(({ key, group, titles }) => ({
    key,
    titles,
    examples: unique(group, song => `${artistKey(song)}|${titleKey(song)}`).map(example),
  })),
};

console.log(JSON.stringify(report, null, 2));
