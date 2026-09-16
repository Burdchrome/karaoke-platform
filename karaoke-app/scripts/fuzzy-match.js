// fuzzy-match.js — string-similarity helpers for the MusicBrainz verify pass
// (docs/research/llm-assisted-stage1-triage.md, deterministic stages 1–2).
//
// Zero-dep by design (research doc §Deps): Jaro-Winkler for artist names
// (short strings, prefix-weighted, tolerant of OCR noise), token-set overlap
// for titles (word order and extra tokens like "(Live)" shouldn't tank a
// match). Pure functions only — mb-verify.js owns all I/O.

// Same tokenizer shape as cdg-harvest.js: normalizeSongField would weld
// dash-packed filenames into one token, so split on non-alphanumerics instead.
export const tokens = (text) =>
  String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Order-free subset: "Cassidy, Eva" in a filename still confirms "Eva Cassidy".
export function containsAllTokens(haystackTokens, needleTokens) {
  return needleTokens.length > 0 && needleTokens.every((t) => haystackTokens.includes(t));
}

// "Fun. feat. Janelle Monae" → "Fun." — the base artist is what filenames and
// library entries agree on; a feature-clause mismatch is a soft note, not a fail.
export function stripFeatClause(artist) {
  return String(artist ?? '').replace(/\s+(?:feat\.?|featuring|ft\.?|with)\s+.*$/i, '').trim();
}

// Token-level Dice coefficient over unique token sets, 0..1. Deliberately
// simple: "We Are Young" vs "We Are Young (Glee)" ≈ 0.86 (passes at 0.85),
// while the truncation trap "Alone Again" vs "Alone Again Naturally" = 0.80
// (fails → stays for human/LLM judgment, which is the correct outcome).
export function tokenSetSimilarity(a, b) {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

// Textbook Jaro-Winkler, 0..1. Winkler prefix bonus capped at 4 chars, p=0.1.
export function jaroWinkler(rawA, rawB) {
  const a = String(rawA ?? '').toLowerCase();
  const b = String(rawB ?? '').toLowerCase();
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array(a.length).fill(false);
  const bMatched = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(b.length - 1, i + matchWindow);
    for (let j = start; j <= end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}
