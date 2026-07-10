# Metadata Cleanup Pipeline — Spec

**Status:** locked 2026-07-09 · destination of wayfinder map [#1](https://github.com/Burdchrome/karaoke-platform/issues/1)
**Decisions only** — this is what gets built; how it's ticketed is `/to-tickets`' job.
**Ground truth:** ADR 0001 (song identity), tickets #2–#5 (measurements + decisions),
`docs/research/disc-code-lookup-sources.md` (lookup verdict).

## Goal & target

Fix the ~1,300 songs (2%) with wrong or missing metadata down to a target of
**99% correct**. Measured baseline (ticket #3, against the verified 65,832-song
library): 98.7% artist-present, 875 hard failures, ~450 silently-inverted
artist/title pairs in mixed-order packs (DKM/ZMP/TU).

## Pipeline stages

```
scan (walk E:\karaoke) → parseFilename (upgraded) → songKey grouping → cache v2
```

**No DB-lookup stage.** Dropped per ticket #4: no API-accessible source covers the
disc codes, and only 59 unique code-only files would benefit. Their rescue is
manual issue #8, post-pipeline, via the overrides file (below).

## 1. Parser upgrade (`parseFilename` in `server/library.js`)

### 1a. Comma-shape inversion fix (~10 lines)

For `DISC - X - Y` matches: if exactly one of X/Y is shaped like `Last, First`
(person name), that segment is the **artist**, regardless of `TITLE_FIRST_PREFIXES`.
The prefix table remains only as the tiebreak when neither (or both) match.

```
// ponytail: comma-shape heuristic; per-disc override table only if
// post-fix spot-check still shows a specific disc inverted (3-line patch then)
```

Fixes ~450 songs. Known accepted risk: a comma-shaped *title* ("Luck, Be A Lady")
could misfire — measured ≈ 0 occurrences in clean prefixes.

### 1b. New pass: stray-space disc codes (77 files)

`SC 8385-15 - Artist - Title` → code `SC8385-15` (collapse the space), then
normal artist/title handling. Files that are *only* a stray-space code
(`CBEP 454-1-06`, no text) still fail → they're on #8's list.

### 1c. New pass: underscore-separated names (19 files + ugly-parse cleanup)

Filenames using `_` as the separator (`_Asleep_At_The_Wheel_-_Blues_For_Dixie`):
translate `_` → space before parsing, and de-underscore output fields on files
that currently "parse" with underscores intact.

### Explicitly out of scope (99% target, ticket #5)

- No-separator files (445) — no structure to parse; still findable by filename search
- Tight-dash (163) and digits-in-left (106) buckets
- trackNN/numeric-only (65) → joined issue #8's manual checklist (~120 files total)
- Fuzzy/edit-distance matching, audio fingerprinting — deferred per the map

## 2. Grouping key (`songKey`) — ADR 0001

Per-file IDs stay as-is (SHA-1 of path). New derived field groups versions of the
same song:

```
songKey = normalize(artist) + '|' + normalize(title)
```

`normalize()`, in order:
1. lowercase + trim + collapse whitespace
2. strip punctuation (`don't` → `dont`, `u & ur hand` → `u ur hand`)
3. fold "The": leading `the ` removed; trailing `, the` removed
   (`Cranberries` ≡ `The Cranberries`; `Walk, The` ≡ `The Walk`)
4. strip trailing `(…)` suffix from the title — the stripped text is **kept**
   on the file entry as `versionLabel` (e.g. `Radio Version`, `Duet`)

> **Errata (2026-07-10, #12):** the numbered order above doesn't execute as
> written — step 2 removes the comma that step 3's trailing `, the` rule needs,
> and step 4's parens must come off before the trailing fold can fire. The
> implementation runs: parens→versionLabel first, then lowercase/collapse →
> fold The → strip punctuation. Same results the spec intends.

```
// ponytail: no fuzzy matching — add when a real ungrouped duplicate is reported
```

**UI behavior (follows from rule 4):** search results group by `songKey` — the
singer sees one "Dreams"; expanding shows each file with disc code +
`versionLabel` so the DJ picks the exact version. (Serve-time `versions`
grouping in `server/index.js` migrates to `songKey`.)

## 3. Manual overrides file

`overrides.json` at the app root: map of file id (or filename) →
`{ artist, title }`, applied after parsing, before grouping. This is the
mechanism issue #8 feeds (freedb-grep + listening checklist, ~120 files).
Ships empty; the pipeline only needs to *consume* it.

## 4. Cache schema v2

`library-cache.json` gains `"version": 2`. On load: version mismatch (or absent)
→ full rescan. New per-song fields: `songKey`, `versionLabel`.

**No CLI refresh tool** (`refresh-metadata.js` dropped): the version bump makes
parser upgrades self-applying on next start, and the manual case is an npm alias:

```json
"rescan": "FORCE_RESCAN=1 node server/index.js"
```

## 5. Verification plan (acceptance)

Re-run the ticket-#3 measurement against the rebuilt cache:
- inversion count (person-name-shaped titles in DKM/ZMP/TU) ≈ 0
- artist-present ≥ 98.7% — **no regressions** on currently-parsing files
- hard-failure count drops by ~96 (stray-space + underscore buckets)
- fresh 40-song stride-sampled spot-check reads clean
- `songKey` sanity: known multi-disc songs ("Dreams" SC8199/DK067-style) group;
  spot-check that distinct songs did NOT merge

The measurement script exists (session scratchpad, ticket #3); it should land in
the repo as `scripts/measure-parse-coverage.js` and run as part of this work.
