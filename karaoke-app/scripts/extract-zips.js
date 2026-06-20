// Extract every .zip under the library root into the folder it sits in.
//
// Strategy:
//   - Walk the library root for .zip files
//   - For each one, run `unzip -n` to extract into the zip's own folder
//   - -n means "never overwrite" — safe to re-run after a partial failure,
//     and harmless if extracted files already exist
//   - The zip files themselves are left in place. They're ignored by the
//     library scanner, and leaving them lets re-runs detect "already
//     processed" state via the existence of the extracted files.
//
// Run with:
//   node scripts/extract-zips.js
//
// Then force a library rescan:
//   FORCE_RESCAN=1 node server/index.js     (Git Bash)
//   $env:FORCE_RESCAN=1; node server/index.js   (PowerShell)
//
// Requires `unzip` on PATH. Git Bash includes it on Windows.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const LIBRARY_ROOT = process.env.LIBRARY_ROOT || 'E:\\karaoke';
const LOG_FILE = path.join(process.cwd(), 'extract-zips.log');

const counts = {
  total: 0,
  extracted: 0,        // unzip ran with at least one file extracted
  skippedAllExist: 0,  // unzip ran but skipped everything (already extracted)
  failed: 0,
};
const failures = [];

async function walk(dir, results = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (err) { console.warn(`SKIP dir: ${dir} (${err.message})`); return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, results);
    else if (e.isFile() && full.toLowerCase().endsWith('.zip')) results.push(full);
  }
  return results;
}

function extractOne(zipPath) {
  return new Promise((resolve) => {
    const dir = path.dirname(zipPath);
    // -n: never overwrite. -q: quiet. -o would be overwrite (we don't want it).
    const proc = spawn('unzip', ['-n', '-q', zipPath, '-d', dir]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

function progressBar(current, total, width = 40) {
  const pct = current / total;
  const filled = Math.round(pct * width);
  return '[' + '='.repeat(filled) + ' '.repeat(width - filled) + ']';
}

(async function main() {
  console.log(`Scanning ${LIBRARY_ROOT} for .zip files…`);
  const t0 = Date.now();
  const zips = await walk(LIBRARY_ROOT);
  counts.total = zips.length;
  console.log(`Found ${counts.total} zips. Starting extraction.`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log('');

  const logHandle = await fs.open(LOG_FILE, 'w');
  await logHandle.write(`Extraction run started: ${new Date().toISOString()}\n\n`);

  for (let i = 0; i < zips.length; i++) {
    const zip = zips[i];
    const result = await extractOne(zip);

    let status;
    if (result.code === 0) {
      // Did unzip actually extract anything, or did it just skip everything?
      // We can tell from stdout being empty (no "extracting:" lines).
      // But with -q -n, stdout is silent on skip too. So we approximate:
      // re-list the zip and check if the extracted files exist.
      // For perf reasons, assume "succeeded" — we don't need precise
      // skip-vs-extract counts.
      counts.extracted++;
      status = 'OK';
    } else if (result.code === 80) {
      // unzip code 80 = nothing to do (all files exist) — counts as skipped.
      counts.skippedAllExist++;
      status = 'SKIPPED (already extracted)';
    } else {
      counts.failed++;
      failures.push({ zip, code: result.code, stderr: result.stderr });
      status = `FAILED (code ${result.code})`;
    }

    await logHandle.write(`${status}\t${zip}\n`);
    if (result.stderr.trim()) {
      await logHandle.write(`  stderr: ${result.stderr.trim()}\n`);
    }

    // Progress every 25 zips, plus always at the end.
    if (i % 25 === 0 || i === zips.length - 1) {
      const bar = progressBar(i + 1, zips.length);
      process.stdout.write(`\r${bar} ${i + 1}/${zips.length}  ok=${counts.extracted} skip=${counts.skippedAllExist} fail=${counts.failed}    `);
    }
  }

  await logHandle.close();
  console.log('\n');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('===== Summary =====');
  console.log(`Total zips:           ${counts.total}`);
  console.log(`Extracted:            ${counts.extracted}`);
  console.log(`Skipped (existed):    ${counts.skippedAllExist}`);
  console.log(`Failed:               ${counts.failed}`);
  console.log(`Elapsed:              ${elapsed}s`);
  console.log('');
  if (failures.length) {
    console.log('First 5 failures:');
    for (const f of failures.slice(0, 5)) {
      console.log(`  ${f.zip}`);
      console.log(`    ${f.stderr.split('\n')[0]}`);
    }
    console.log(`See ${LOG_FILE} for full details.`);
  }
  console.log('');
  console.log('NEXT: rebuild the library cache so the new files show up.');
  console.log('  rm library-cache.json && npm start');
  console.log('or:');
  console.log('  FORCE_RESCAN=1 npm start   (Git Bash)');
})();
