# CDG Title-Screen Verification Pipeline — Handoff Plan

**Drafted:** 2026-07-17, out of issue #8's rescue session.
**Status:** needs-triage (Josh has not ratified yet)

## The idea, in one line

Every CDG file renders a title card (~5–15s in) showing the real TITLE +
"IN THE STYLE OF" + artist. That's ground truth *inside the file itself* —
use it to name the unnamed and audit the named, instead of trusting
filenames or external databases.

## Why we believe it (evidence, not theory)

Issue #8, 2026-07-16/17: three code-only files resolved by reading their
title cards in the app (`CB 7002-03` → Elvis / Farther Along, `CB 7002-14` →
Elvis / Reach Out To Jesus, `esp451-4-04` → George Jones / She Thinks I
Still Care). freedb had guessed wrong on two of the three; the screens were
right every time — confirmed by named library twins after the fact.

## Pipeline (4 small pieces)

1. **`cdg-snapshot.js`** — Node CLI, reuses the app's existing `cdgraphics`
   dependency (no new deps). Decode the first ~25s of a CDG, dump frames at
   ~5/8/12/20s as upscaled PNGs (300×216 native → ×3). Cost: well under 1s
   per file, CPU only.
2. **Reader** — two tiers:
   - **Tier A (fast): OCR** (tesseract) on the upscaled frame. Unknown
     accuracy on the blocky CDG font — Stage 0 measures it.
   - **Tier B (proven): `qwen3-vl:8b`** local vision — 95–98% verbatim on
     *dense* screenshots (screenshot-vault trial); title cards are far
     simpler. Observed ~2.5 min/image warm on dense input; expect faster
     here — measure, don't assume. All local, no pixels leave the machine.
3. **Comparator** — normalize ("IN THE STYLE OF", casing, punctuation),
   compare against the parsed artist/title. Verdict per file:
   `MATCH / MISMATCH / UNREADABLE` + the proposed `{artist, title}`.
4. **Outputs** — everything staged, nothing auto-applied:
   - `cdg-proposals.json` — override candidates, same shape as
     `overrides.json`. **Promotion is manual: Josh skims, Claude merges.**
   - `mismatch-report.csv` — for the audit stages.
   - Run log (files/sec, tier used, confidence).

## Boundaries (Agent Philosophy #6)

- Library access: **read-only**. Writes: proposals + report files only.
- `overrides.json` is never touched by the pipeline — human gate stays.
- Vision runs local (qwen3-vl). Schedule around llama-server: they can't
  share the 12GB card (VRAM contention, known).

## Stages — each has a stopping point and a gate

**Stage 0 — calibrate (½ session).**
Run the pipeline on files where we KNOW the answer: the 17 current
overrides + ~20 random well-named files. Score OCR vs vision against known
truth. *Gate: reader ≥95% correct → continue with that tier; OCR fails →
vision-only route (changes the timeline, not the plan).*

**Stage 1 — the rescue (the actual point).**
Run on the 839 hard failures + the 4 remaining code-only unknowns.
Everything readable becomes a staged proposal; Josh ratifies in one skim
(~20–30 min) instead of an evening of listening. *This replaces most of the
issue #8 listening checklist.*

**Stage 2 — the audit (optional, decide after Stage 1).**
Sweep named files for filename-vs-screen mismatches (silent mislabels the
parser can't see). Full library on OCR ≈ 1–2 days background; on
vision-only, full sweep is infeasible (~months) — sample instead (e.g. one
file per songKey, or suspect populations like the 34 flagged inversions).

**Stage 3 — adjacent, separate decision.**
Dedup: today we saw "4 versions" that are byte-identical copies. Content
hashing solves that. Different problem, don't bundle it here.

## Time estimates (honest ranges, Stage 0 tightens them)

**Measured 2026-07-18 (Stage 0), vision route — the OCR route was dropped:**

| Run | Vision (measured) |
|---|---|
| Stage 0 calibration | ~25 min GPU for 17 files |
| Stage 1 (843 files) | **~5–12 h ≈ one overnight** (was estimated 35 h) |
| Stage 2 full (65,818) | still infeasible — sample only |
| Josh's time, all stages | ~30 min ratifying |

Vision measured at 13.7s/frame, 51.4s/file, 2.5 frames/file — one overnight
for Stage 1, so tesseract was never installed and **the OCR tier is dropped**.
No new dependency.

## Open questions Stage 0 answered

- **Timing variance:** fixed timestamps don't work; `--scan` change detection
  is the default. Cards land anywhere from t2 (Sound Choice) to t8.
- **Files with no title card:** none of the 17. Two files had cards the
  pipeline mishandled (issue #22), not missing ones.
- **Vision throughput:** 13.7s/frame — the 2.5-min figure was dense-screenshot
  input, not simple cards.
- **OCR accuracy:** never measured, and no longer needs to be.
- **New:** some labels (Top Tunes) **truncate long titles on screen** —
  unrecoverable from pixels; Stage 1 needs partial-title matching.

## First step

Build `cdg-snapshot.js` and run it on the 17 known-truth files. Nothing
else until those frames are on disk and readable. One sitting.
