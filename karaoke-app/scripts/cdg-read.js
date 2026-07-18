// cdg-read.js — read CDG title-card frames with the local vision model (issue #21).
//
// Pipeline piece 2 (reader) + 3 (comparator). Takes the PNG frames written by
// cdg-snapshot.js, asks qwen3-vl (local, via Ollama) what the card says, and —
// when a truth file is supplied — scores the reads to measure accuracy.
// Read-only: writes nothing but its own --out report.
//
// Usage:
//   node scripts/cdg-read.js --frames DIR [--out report.json]
//   node scripts/cdg-read.js --frames DIR --truth overrides.json   (calibration)
//   node scripts/cdg-read.js --frames DIR --all-frames             (no early stop)
//
// Frames are grouped by the "<base>__tNN.png" name cdg-snapshot.js writes and
// read in time order. By default the reader stops at the first frame that is a
// title card — that is how Stage 1 will run, so that is what calibration times.

import fs from 'node:fs';
import path from 'node:path';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const FRAME_TIMEOUT_MS = 180_000;

// Cards read "IN THE STYLE OF <artist>"; some labels (Music Maestro) print the
// songwriters instead of the performer, so artist absence is not a mismatch.
const READ_PROMPT = `This image is a single frame from a karaoke CD+G video.

If it is a title card, transcribe EXACTLY what is printed on it:
- the song title (usually the largest text, at the top)
- the performing artist, printed after "IN THE STYLE OF"

Rules:
- Transcribe only what you can actually see. Never fill in a title or artist
  from your own knowledge of the song.
- If the frame shows song lyrics, a key-change notice, a disc or
  album banner, or a blank screen, it is not a title card. A title card may
  carry the label's logo above the title (Music Maestro does this).
- If a field is not printed on the frame, use null.

Answer with only this JSON:
{"all_text": "every line on the frame, separated by \\n",
 "is_title_card": true|false, "title": "..." or null, "artist": "..." or null}`;

// ---- reading ----

async function readFrame(framePath, model) {
  const imageBase64 = fs.readFileSync(framePath).toString('base64');
  const startedAt = Date.now();

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: READ_PROMPT,
      images: [imageBase64],
      stream: false,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status} reading ${path.basename(framePath)}`);
  }

  const body = await response.json();
  const seconds = (Date.now() - startedAt) / 1000;

  // Ollama's format:"json" makes this thinking model emit its whole answer as
  // `thinking` and return an empty `response` — so ask for JSON in the prompt
  // and pull it back out of the prose instead.
  const jsonMatch = body.response?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in model output for ${path.basename(framePath)}: ${body.response?.slice(0, 200)}`);
  }
  let read;
  try {
    read = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Unparseable model output for ${path.basename(framePath)}: ${jsonMatch[0].slice(0, 200)}`);
  }
  return { ...read, seconds };
}

// ---- comparing ----

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\bin the style of\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Cards print artists inverted ("Cassidy, Eva", "Platters, The"), which is the
// same comma shape the filename parser had to learn — compare order-free.
function isSameArtist(readArtist, truthArtist) {
  const readTokens = normalize(readArtist).split(' ').filter(Boolean).sort();
  const truthTokens = normalize(truthArtist).split(' ').filter(Boolean).sort();
  return readTokens.length > 0 && readTokens.join(' ') === truthTokens.join(' ');
}

// Real cards linger across frames, disc banners flash once — most-seen title wins, later frame breaks ties.
function pickMostSeenTitle(candidates) {
  if (candidates.length < 2) return candidates[0] ?? null;
  const counts = new Map();
  for (const candidate of candidates) {
    const key = normalize(candidate.title);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...candidates].sort((a, b) =>
    counts.get(normalize(b.title)) - counts.get(normalize(a.title)) || b.time - a.time
  )[0];
}

function scoreRead(read, truth) {
  const titleVerdict = !read?.title
    ? 'UNREAD'
    : normalize(read.title) === normalize(truth.title) ? 'MATCH' : 'MISMATCH';
  const artistVerdict = !read?.artist
    ? 'UNCONFIRMED'
    : isSameArtist(read.artist, truth.artist) ? 'MATCH' : 'MISMATCH';
  return { titleVerdict, artistVerdict };
}

// ---- CLI ----

function parseArgs(argv) {
  const args = { frames: '', truth: '', out: '', model: 'qwen3-vl:8b', allFrames: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frames') args.frames = argv[++i];
    else if (argv[i] === '--truth') args.truth = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--all-frames') args.allFrames = true;
  }
  return args;
}

// Write tmp-then-rename so a crash mid-write can't truncate the report resume reads.
function writeReport(outPath, report) {
  fs.writeFileSync(`${outPath}.tmp`, JSON.stringify(report, null, 2));
  fs.renameSync(`${outPath}.tmp`, outPath);
}

function groupFramesByFile(framesDir) {
  const groups = new Map();
  for (const fileName of fs.readdirSync(framesDir)) {
    if (!fileName.endsWith('.png')) continue;
    const [baseName, timeLabel] = path.basename(fileName, '.png').split('__t');
    if (!timeLabel) continue;
    if (!groups.has(baseName)) groups.set(baseName, []);
    groups.get(baseName).push({ path: path.join(framesDir, fileName), time: Number(timeLabel) });
  }
  for (const frames of groups.values()) frames.sort((a, b) => a.time - b.time);
  return groups;
}

const args = parseArgs(process.argv.slice(2));
if (!args.frames) {
  console.error('Usage: node scripts/cdg-read.js --frames DIR [--truth overrides.json] [--out report.json] [--all-frames]');
  process.exit(1);
}

const frameGroups = groupFramesByFile(args.frames);
const truth = args.truth ? JSON.parse(fs.readFileSync(args.truth, 'utf8')) : null;
const truthByNormalizedKey = new Map(
  Object.entries(truth ?? {}).map(([key, value]) => [normalize(key), value])
);

console.log(
  `Reading ${frameGroups.size} file(s) with ${args.model}` +
  `${args.allFrames ? ' (all frames)' : ' (stop at first title card)'}` +
  `${truth ? ` — scoring against ${args.truth}` : ''}`
);

// An overnight Stage 1 run must survive a crash: the report is rewritten after
// every file, and rerunning with the same --out resumes past what's already read.
const checkpointed = args.out && fs.existsSync(args.out)
  ? JSON.parse(fs.readFileSync(args.out, 'utf8')).results
  : [];
// A file with no read AND errors only failed transiently — retry it on resume.
const priorResults = checkpointed.filter((r) => r.read || !r.errors?.length);
if (priorResults.length) console.log(`Resuming: ${priorResults.length} file(s) already in ${args.out}`);
const doneFiles = new Set(priorResults.map((r) => r.file));

const results = [...priorResults];
let frameCount = 0;
let frameSeconds = 0;

for (const [baseName, frames] of frameGroups) {
  if (doneFiles.has(baseName)) continue;
  const fileStartedAt = Date.now();
  const result = { file: baseName, framesRead: 0, read: null, cardTime: null, candidates: [], errors: [] };

  for (const frame of frames) {
    let read;
    try {
      read = await readFrame(frame.path, args.model);
    } catch (err) {
      // This thinking model intermittently ends its turn with an empty answer;
      // one retry recovers it rather than losing the frame.
      console.error(`  RETRY ${baseName} t${frame.time}: ${err.message}`);
      try {
        read = await readFrame(frame.path, args.model);
      } catch (retryErr) {
        result.errors.push(`t${frame.time}: ${retryErr.message}`);
        console.error(`  ERR  ${baseName} t${frame.time}: ${retryErr.message}`);
        continue;
      }
    }
    result.framesRead++;
    frameCount++;
    frameSeconds += read.seconds;

    if (read.is_title_card && read.title) {
      result.candidates.push({ time: frame.time, title: read.title, artist: read.artist ?? null, allText: read.all_text ?? null });
      // Only title+artist is a certain stop: discs open with album/label cards
      // that also look like title cards, and title-only cards are ambiguous.
      if (read.artist && !args.allFrames) break;
    }
  }

  // No artist on any frame (Music Maestro prints songwriters): best title-only read.
  result.read = result.candidates.find((candidate) => candidate.artist)
    ?? pickMostSeenTitle(result.candidates);
  result.cardTime = result.read?.time ?? null;
  result.seconds = Number(((Date.now() - fileStartedAt) / 1000).toFixed(1));

  const truthEntry = truthByNormalizedKey.get(normalize(baseName));
  if (truthEntry) {
    result.truth = truthEntry;
    Object.assign(result, scoreRead(result.read, truthEntry));
  }

  const readLabel = result.read
    ? `"${result.read.title}" / ${result.read.artist ?? '(no artist on card)'}`
    : 'NO TITLE CARD FOUND';
  const scoreLabel = truthEntry ? ` [title ${result.titleVerdict}, artist ${result.artistVerdict}]` : '';
  console.log(`  ${baseName}: ${readLabel} (t${result.cardTime ?? '-'}, ${result.framesRead} frames, ${result.seconds}s)${scoreLabel}`);
  results.push(result);
  // Checkpoint after every file; the summary lands with the final write below.
  if (args.out) writeReport(args.out, { results });
}

const summary = {
  files: results.length,
  framesRead: results.reduce((total, r) => total + r.framesRead, 0),
  secondsPerFrame: frameCount ? Number((frameSeconds / frameCount).toFixed(1)) : 0,
  secondsPerFile: results.length
    ? Number((results.reduce((total, r) => total + r.seconds, 0) / results.length).toFixed(1))
    : 0,
  cardsFound: results.filter((r) => r.read).length,
};
if (truth) {
  const scored = results.filter((r) => r.truth);
  summary.titleMatches = scored.filter((r) => r.titleVerdict === 'MATCH').length;
  summary.titleMismatches = scored.filter((r) => r.titleVerdict === 'MISMATCH').length;
  summary.titleUnread = scored.filter((r) => r.titleVerdict === 'UNREAD').length;
  summary.artistMatches = scored.filter((r) => r.artistVerdict === 'MATCH').length;
  summary.artistMismatches = scored.filter((r) => r.artistVerdict === 'MISMATCH').length;
  summary.artistUnconfirmed = scored.filter((r) => r.artistVerdict === 'UNCONFIRMED').length;
  summary.titleAccuracy = scored.length
    ? Number(((summary.titleMatches / scored.length) * 100).toFixed(1))
    : 0;
}

console.log('\nSummary:', JSON.stringify(summary, null, 2));

if (args.out) {
  writeReport(args.out, { summary, results });
  console.log(`Report written to ${args.out}`);
}
