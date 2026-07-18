// cdg-snapshot.js — render CDG title-card frames to PNG (issue #21, Stage 0+).
//
// The CDG file itself shows the true title + artist a few seconds in; these
// snapshots are the ground truth the verification pipeline reads. This script
// is the "camera" only — no OCR, no comparison, no writes outside --out.
//
// Usage:
//   node scripts/cdg-snapshot.js --out DIR [--times 4,8,12,20] <cdgPath...>
//   node scripts/cdg-snapshot.js --out DIR --scan [--scan-window 40] <cdgPath...>
//   node scripts/cdg-snapshot.js --out DIR [--scan] --from-overrides
//
// --scan: instead of fixed timestamps, sample every second and keep only
// frames that differ meaningfully from the last kept one. Labels time their
// title cards differently (Sound Choice's arrives after 20s; Chartbuster's
// at ~5s), so change-detection beats any fixed schedule.
// --from-overrides: snapshot one copy of every file keyed in overrides.json
// (the known-truth calibration set), resolved via library-cache.json. Run
// from the karaoke-app directory so both files are in cwd.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import CDGraphics from 'cdgraphics';

// cdgraphics targets browsers; ImageData is its only browser global.
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

const SCALE = 3; // 300x216 native is too small for OCR; 900x648 reads cleanly

// ---- minimal PNG writer (8-bit RGB, no filtering) ----

function writePngChunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndBody));
  return Buffer.concat([length, typeAndBody, crc]);
}

function encodePng(imageData) {
  const { width, height, data } = imageData;
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;

  // each row starts with filter byte 0, pixels upscaled nearest-neighbor
  const rows = Buffer.alloc(outHeight * (1 + outWidth * 3));
  let offset = 0;
  for (let y = 0; y < outHeight; y++) {
    rows[offset++] = 0;
    const sourceRow = Math.floor(y / SCALE) * width;
    for (let x = 0; x < outWidth; x++) {
      const sourceIndex = (sourceRow + Math.floor(x / SCALE)) * 4;
      rows[offset++] = data[sourceIndex];
      rows[offset++] = data[sourceIndex + 1];
      rows[offset++] = data[sourceIndex + 2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(outWidth, 0);
  header.writeUInt32BE(outHeight, 4);
  header[8] = 8;  // bit depth
  header[9] = 2;  // color type: truecolor RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    writePngChunk('IHDR', header),
    writePngChunk('IDAT', zlib.deflateSync(rows)),
    writePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- snapshot ----

// Fraction of pixels that must change for a frame to count as a new screen.
// Cursor blinks and progress bars stay below this; a new card blows past it.
const CHANGE_THRESHOLD = 0.03;
const MAX_SCAN_FRAMES = 8;

function countChangedPixels(previousData, currentData) {
  let changed = 0;
  for (let i = 0; i < currentData.length; i += 4) {
    if (
      previousData[i] !== currentData[i] ||
      previousData[i + 1] !== currentData[i + 1] ||
      previousData[i + 2] !== currentData[i + 2]
    ) changed++;
  }
  return changed;
}

function loadCdg(cdgPath) {
  const fileBytes = fs.readFileSync(cdgPath);
  return new CDGraphics(
    fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength)
  );
}

function snapshotCdg(cdgPath, times, outDir) {
  const cdg = loadCdg(cdgPath);
  const baseName = path.basename(cdgPath, path.extname(cdgPath));
  const written = [];
  for (const time of times) {
    // render() is stateful and seeks forward; ascending times keeps it cheap
    const frame = cdg.render(time);
    const outPath = path.join(outDir, `${baseName}__t${String(time).padStart(2, '0')}.png`);
    fs.writeFileSync(outPath, encodePng(frame.imageData));
    written.push(outPath);
  }
  return written;
}

function scanCdg(cdgPath, scanWindow, outDir) {
  const cdg = loadCdg(cdgPath);
  const baseName = path.basename(cdgPath, path.extname(cdgPath));
  const written = [];
  let lastKeptData = null;

  for (let time = 1; time <= scanWindow; time++) {
    const frame = cdg.render(time);
    const pixelCount = frame.imageData.width * frame.imageData.height;
    const isNewScreen =
      !lastKeptData ||
      countChangedPixels(lastKeptData, frame.imageData.data) / pixelCount > CHANGE_THRESHOLD;
    if (!isNewScreen) continue;

    // wait one more second so we don't save a card mid-draw
    const settled = cdg.render(time + 1);
    const outPath = path.join(outDir, `${baseName}__t${String(time + 1).padStart(2, '0')}.png`);
    fs.writeFileSync(outPath, encodePng(settled.imageData));
    written.push(outPath);
    lastKeptData = Uint8ClampedArray.from(settled.imageData.data);

    if (written.length >= MAX_SCAN_FRAMES) break;
  }
  return written;
}

// ---- CLI ----

function parseArgs(argv) {
  const args = {
    times: [4, 8, 12, 20], paths: [], out: '',
    fromOverrides: false, scan: false, scanWindow: 40,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--times') args.times = argv[++i].split(',').map(Number);
    else if (argv[i] === '--from-overrides') args.fromOverrides = true;
    else if (argv[i] === '--from-failures') args.fromFailures = true;
    else if (argv[i] === '--scan') args.scan = true;
    else if (argv[i] === '--scan-window') args.scanWindow = Number(argv[++i]);
    else args.paths.push(argv[i]);
  }
  return args;
}

function resolveOverridePaths() {
  const overrides = JSON.parse(fs.readFileSync('overrides.json', 'utf8'));
  const { songs } = JSON.parse(fs.readFileSync('library-cache.json', 'utf8'));
  const byFilename = new Map();
  for (const song of songs) {
    if (!byFilename.has(song.filename.toLowerCase())) {
      byFilename.set(song.filename.toLowerCase(), song);
    }
  }
  const resolved = [];
  for (const key of Object.keys(overrides)) {
    const song = byFilename.get(key.toLowerCase());
    if (!song) {
      console.error(`SKIP: override key "${key}" not found in library cache`);
      continue;
    }
    resolved.push(song.cdgPath);
  }
  return resolved;
}

// Stage 1 population (#21): every song the parser couldn't name an artist for.
function resolveFailurePaths() {
  const { songs } = JSON.parse(fs.readFileSync('library-cache.json', 'utf8'));
  return songs.filter((song) => !song.artist && song.cdgPath).map((song) => song.cdgPath);
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('Usage: node scripts/cdg-snapshot.js --out DIR [--times 4,8,12,20] [--from-overrides | --from-failures | <cdgPath...>]');
  process.exit(1);
}
fs.mkdirSync(args.out, { recursive: true });

const cdgPaths = args.fromOverrides ? resolveOverridePaths()
  : args.fromFailures ? resolveFailurePaths()
  : args.paths;
const modeLabel = args.scan ? `scan 1..${args.scanWindow}s` : `t=[${args.times}]`;
console.log(`Snapshotting ${cdgPaths.length} CDG file(s) (${modeLabel}) -> ${args.out}`);

let failCount = 0;
for (const cdgPath of cdgPaths) {
  try {
    const written = args.scan
      ? scanCdg(cdgPath, args.scanWindow, args.out)
      : snapshotCdg(cdgPath, args.times, args.out);
    console.log(`OK  ${path.basename(cdgPath)} (${written.length} frames)`);
  } catch (err) {
    failCount++;
    console.error(`FAIL ${cdgPath}: ${err.message}`);
  }
}
console.log(`Done: ${cdgPaths.length - failCount} ok, ${failCount} failed`);
process.exit(failCount > 0 ? 2 : 0);
