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

function artistAfterStrip(artist) {
  return normalizeSongField(artist).replace(/\b(feat|featuring|ft|with|duet)\b.*$/, '').trim();
}

function proposedArtist(artist) {
  return dropAndTokens(artistAfterStrip(artist)).split(' ').filter(Boolean).sort((a, b) => a.localeCompare(b)).join(' ');
}

function title(song) {
  return dropAndTokens(normalizeSongField(baseTitle(song.title)));
}

function currentArtist(song) {
  return normalizeSongField(song.artist);
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
const groups = [];
for (const [key, group] of groupBy(nonBlank, song => `${proposedArtist(song.artist)}|${title(song)}`)) {
  const artists = [...new Set(group.map(currentArtist))];
  if (artists.length <= 1) continue;
  const anyAndDropped = group.some(song => artistAfterStrip(song.artist).split(' ').includes('and'));
  if (!anyAndDropped) continue;
  groups.push({ key, group, artists });
}

groups.sort((a, b) => b.artists.length - a.artists.length || b.group.length - a.group.length || a.key.localeCompare(b.key));

console.log(JSON.stringify({
  artistAndCollisionGroupCount: groups.length,
  groups: groups.slice(0, 50).map(({ key, group, artists }) => ({
    key,
    songCount: group.length,
    distinctCurrentArtistCount: artists.length,
    examples: unique(group, song => `${currentArtist(song)}|${normalizeSongField(baseTitle(song.title))}`).slice(0, 8).map(song => ({
      example: example(song),
      currentArtist: currentArtist(song),
      strippedArtist: artistAfterStrip(song.artist),
      proposedArtist: proposedArtist(song.artist),
    })),
  })),
}, null, 2));
