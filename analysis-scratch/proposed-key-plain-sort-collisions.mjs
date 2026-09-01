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

function titleKey(song) {
  return normalizeSongField(baseTitle(song.title));
}

function proposedKey(song) {
  return `${proposedArtistParts(song.artist).sorted}|${dropAndTokens(titleKey(song))}`;
}

function currentKey(song) {
  return `${normalizeSongField(song.artist)}|${titleKey(song)}`;
}

function hasRawDelimiter(artist) {
  return /[,/&+]|\b(and|feat|featuring|ft|with|duet)\b/i.test(String(artist ?? ''));
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

function example(song) {
  return `${song.artist || '[blank]'} - ${song.title || '[blank]'} (${song.discCode || '[blank]'})`;
}

const nonBlank = songs.filter(song => song.artist && String(song.artist).trim());
const collisionGroups = [];
for (const [key, group] of groupBy(nonBlank, proposedKey)) {
  const currentKeys = new Set(group.map(currentKey));
  const noAndKeys = new Set(group.map(song => proposedArtistParts(song.artist).noAnd));
  if (currentKeys.size > 1 && noAndKeys.size > 1) {
    collisionGroups.push({ key, group });
  }
}

const allPlainGroups = collisionGroups.filter(({ group }) => group.every(song => !hasRawDelimiter(song.artist)));
const somePlainGroups = collisionGroups.filter(({ group }) => group.some(song => !hasRawDelimiter(song.artist)));

const report = {
  sortedCollisionGroupCount: collisionGroups.length,
  allPlainNoDelimiterGroupCount: allPlainGroups.length,
  somePlainNoDelimiterGroupCount: somePlainGroups.length,
  allPlainNoDelimiterGroups: allPlainGroups.slice(0, 25).map(({ key, group }) => ({
    key,
    examples: unique(group, currentKey).map(song => ({
      example: example(song),
      currentKey: currentKey(song),
      artistTransform: `${proposedArtistParts(song.artist).noAnd} -> ${proposedArtistParts(song.artist).sorted}`,
    })),
  })),
};

console.log(JSON.stringify(report, null, 2));
