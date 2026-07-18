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

| Run | OCR route | Vision route |
|---|---|---|
| Stage 0 calibration | ~1 h total incl. build | same build + ~1.5 h GPU |
| Stage 1 (843 files) | **~1 h** | **~35 h GPU ≈ 2 overnights** |
| Stage 2 full (65,818) | ~1–2 days background | infeasible — sample only |
| Josh's time, all stages | ~30 min ratifying | same |

Build effort: pieces 1+3+4 are one agent session. Tesseract install is the
only new dependency, and only on the OCR route.

## Open questions Stage 0 answers

- Title-card timing variance (is 4 frames enough? which timestamps?)
- OCR accuracy on the CDG tile font (the big fork in the timeline)
- Files with no title card at all (how many, what fallback)
- Actual vision throughput on simple cards (2.5 min is the dense-input
  number)

## First step

Build `cdg-snapshot.js` and run it on the 17 known-truth files. Nothing
else until those frames are on disk and readable. One sitting.
