// Issue #8: list code-only files (hard failures whose filename has no
// artist/title words — just disc codes / numbers).
const fs = require('fs');
const path = process.argv[2];
const { songs } = JSON.parse(fs.readFileSync(path, 'utf8'));

const failures = songs.filter(s => s.artist === '');
// "code-only": strip extension; no run of 2+ consecutive alphabetic words
// (a real title has words; codes look like "SC 8385-15", "rb01403", "CBEP 454-1-06")
const words = t => (t.match(/[A-Za-z]{2,}/g) || []).filter(w => !/^\d+$/.test(w));
const codeOnly = failures.filter(s => {
  const t = s.title.replace(/\.(mp3|cdg|zip)$/i, '');
  const ws = words(t);
  // allow at most one short letter-group (the label prefix like SC, CBEP, rb, DKK)
  return ws.length <= 1 && ws.every(w => w.length <= 4);
});

const byName = new Map();
for (const s of codeOnly) {
  const key = s.filename.toLowerCase();
  if (!byName.has(key)) byName.set(key, s);
}
console.log(`hard failures: ${failures.length}`);
console.log(`code-only entries: ${codeOnly.length}, unique filenames: ${byName.size}\n`);
for (const s of [...byName.values()].sort((a, b) => a.filename.localeCompare(b.filename))) {
  console.log(`${s.filename}\t${s.id}`);
}
