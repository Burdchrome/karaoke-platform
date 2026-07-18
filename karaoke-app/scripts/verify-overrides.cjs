// Confirm every override key matches a real library filename (else it's a no-op),
// and report whether a same-song twin already exists (so they'll merge on songKey).
const fs = require('fs');
const { songs } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const overrides = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const byFilename = new Map();
for (const s of songs) {
  const k = s.filename.toLowerCase();
  if (!byFilename.has(k)) byFilename.set(k, []);
  byFilename.get(k).push(s);
}

const norm = x => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

for (const [key, ov] of Object.entries(overrides)) {
  const matches = byFilename.get(key.toLowerCase());
  const applies = matches ? `applies to ${matches.length} entr${matches.length === 1 ? 'y' : 'ies'}` : 'NO MATCH (no-op!)';
  // does a properly-named twin exist with the same artist+title?
  const twin = songs.find(s =>
    s.artist && norm(s.artist) === norm(ov.artist) && norm(s.title) === norm(ov.title));
  const twinNote = twin ? `twin: ${twin.filename}` : 'no twin (new name)';
  console.log(`${key}\n   -> ${ov.artist} / ${ov.title}\n   ${applies} | ${twinNote}\n`);
}
