// For each disc code in the resolved set, find every library file whose
// filename references that disc — so we can cross-check freedb's track order
// against tracks that ALREADY parsed with real names.
const fs = require('fs');
const { songs } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// disc code -> regex that matches its files (loose: digits with optional sep)
const discs = {
  SC8385:  /sc[ ._-]?8385/i,
  SC8196:  /(sc[ ._-]?8196|819607)/i,
  SC8544:  /sc[ ._-]?8544/i,
  SC8574:  /sc[ ._-]?8574/i,
  SC8133:  /(sc[ ._-]?8133|(^|[^0-9])8133-)/i,
  CB90210: /(cb)?90210/i,
  CB60126: /cb[ ._-]?60126/i,
  CB90030: /cb[ ._-]?90030/i,
  CBEP454: /cbep[ ._-]?454/i,
  LG200:   /lg[ ._-]?200/i,
  MM6018:  /mm[ ._-]?6018/i,
  CB7002:  /cb[ ._-]?7002/i,
  ESP451:  /esp[ ._-]?451/i,
};

for (const [code, rx] of Object.entries(discs)) {
  const hits = songs
    .filter(s => rx.test(s.filename))
    .map(s => ({ f: s.filename, a: s.artist, t: s.title }))
    .sort((x, y) => x.f.localeCompare(y.f));
  console.log(`\n===== ${code} (${hits.length} files) =====`);
  for (const h of hits) {
    const named = h.a ? `${h.a} — ${h.t}` : `(code-only: "${h.t}")`;
    console.log(`  ${h.f}   =>   ${named}`);
  }
}
