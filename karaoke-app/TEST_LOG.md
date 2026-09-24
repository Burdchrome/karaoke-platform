# Karaoke App — Test Log

A running record of manual test sessions against the karaoke server. Each session lists what changed since the last verified state, the tests run, and the result. The point: catch regressions, build a checklist that grows with the app.

---

## Session: 2026-09-24 (#30 ratification run + #29 fork ruling + #31 merge)

### What changed

1. **Fork rulings** (issue comments on #28/#29) — (1) `--mb-report` /
   `--judge-report` blessed as read-path seams; (2) `--sample` attaches
   card-audit notes to any dealt record, confirmed bucket included.
2. **Sample view carries audit notes** (`a4dbb79`) — `sampleBucket()`
   takes an optional `cardAudit`; `main` passes `readCardAudit()` through.
   Test-first: unit + e2e went red, then green. 8 real cardSilent notes
   now surface on confirmed records before `--apply`.
3. **Ratification run** (`189d046`, #30) — 26 records reviewed on a
   claude.ai artifact page (evidence + CDG title-card frames via
   `cdg-snapshot --scan` + 60s mono clip per record; rulings stored in
   the page's db and read back). 26/26 pass. `--apply
   confirmed,corrected,resolved,judge:confirmed,judge:corrected` → added
   113, skipped 1 (already present). overrides.json 314 → 427.
4. **Overrides × grouping seam tests** (`ddb5c0e`) — five tests in
   `server/library.test.js` on what `applyOverrides` and `groupSongs` do
   together: orphan joins the named group; one filename key reaches every
   copy → one group; no merge of two songs sharing a title; idempotent;
   invariant that overrides never increase the group count.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Unit: sampleBucket attaches note to '632202', none to '632204', none without audit | red before change, green after | ✅ | |
| 2 | E2E: --sample confirmed shows `auditNote:` on exactly the audited record | red before, green after | ✅ | |
| 3 | Live: --sample confirmed --n 400 against real reports | audit notes appear on confirmed records | ✅ | 5+ notes seen, writers-only cautions |
| 4 | --apply five buckets | 98+2+8+5+1 = 114 minus collisions | ✅ | 113 added, 1 skipped |
| 5 | Spot-check via `loadLibrary()` (real server load path) | Technologic→Daft Punk; PSJT201 Tomorrow Night→Elvis; That Summer→Garth Brooks; all 4 one→All‐4‐One | ✅ | "Applied 612 manual overrides" (entries match multiple copies) |
| 6 | Full suite `npm test` | 131 pass / 1 gated skip | ✅ | |
| 7 | `npm run check` | clean | ✅ | |
| 8 | Blast radius: `applyOverrides` on the real cache with old vs new overrides.json | only blank-artist files change; group count falls | ✅ | 177 files changed, all 177 previously blank artist, 0 named songs altered; groups 37,789 → 37,687 |
| 9 | Seam tests green, then mutation check (skip songKey recompute in `applyOverrides`) | 5 pass; mutant fails ≥ 3 of them | ✅ | mutant failed 6 (3 new + 3 existing); restored, 68 pass |

**Tier:** **verified-in-test** for the code change; the 113 promotions are
**verified-in-test** via the real loader, not yet in-use. Graduates to
verified-in-use at the next real gig launch when a DJ search lands on a
promoted record (e.g. "Technologic" → Daft Punk).

### Follow-ups

- [ ] Unicode hyphens (U+2010) from MusicBrainz in "All‐4‐One" — check DJ
  search for "all-4-one" still hits at next launch; if not, normalise
  hyphens in the search index, not the override.
- [ ] Rerun `--queue` view work for the 130 human-queue records — the run
  covered promotable buckets only; the queue is untouched by design.

---

## Session: 2026-09-18 (triage promotion gate #28 + sample/queue views #29)

### What changed

1. **Triage apply gate** (`7a22d70`, #28) — `scripts/triage-apply.js
   --apply <buckets>` merges named verdict buckets from mb-verify and
   llm-judge reports into `overrides.json`. Mirrors `cdg-harvest --apply`:
   explicit bucket names only, existing overrides win on collision,
   idempotent, unknown/human-queue buckets refused before any file I/O.
   Exports pure `planApply()` for unit testing. Review ladder: Codex →
   Sonnet advisor (deduped validation, added error-path tests) → fresh
   /code-review (stopped message-regex dispatch, added loud missing-value
   errors).
2. **Sample + queue views** (`d930109`, #29) — two read-only modes on the
   same tool. `--sample <bucket> --n N` deals random records with evidence
   for ruling; `--queue` lists all 130 human-queue records (57 flagged +
   45 judge:flagged + 16 receipt_failed + 12 demoted) with card-audit
   notes attached. Tolerant trailing-comma parse on the hand-written audit
   cache; missing cache warns and continues. Review ladder caught:
   `convictionOverturned` printed raw JSON (fixed, `resolution` field now
   preferred), bidirectional cardSilent prefix match (dropped reverse
   direction), vacuous e2e assertion (fixed to count occurrences), stale
   file header (updated to document all three modes).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Unit: planApply promotes proposal/suggestion per bucket, skips collisions, throws on bad names | 7 assertions | ✅ | |
| 2 | E2E: --apply on fixture reports + temp overrides, idempotent rerun, unknown bucket = non-zero, real files untouched | 5 assertions | ✅ | child-process seam |
| 3 | Unit: sampleBucket deals N, reaches judge/queue buckets, throws on unknown | 2 assertions | ✅ | |
| 4 | Unit: buildQueue lists 4 groups, attaches audit notes incl. resolution text, works without audit | 4 assertions | ✅ | |
| 5 | E2E: --sample deals N with evidence, read-only proven by hash | 1 assertion | ✅ | |
| 6 | E2E: --queue lists all groups with audit notes, cardSilent prefix, convictionOverturned resolution text, read-only | 1 assertion | ✅ | |
| 7 | E2E: missing card-audit → warn + queue runs; corrupt card-audit → loud failure | 2 assertions | ✅ | |
| 8 | E2E: modes mutually exclusive | 1 assertion | ✅ | |
| 9 | Full suite `npm test` | 129 pass / 1 gated skip / 0 fail | ✅ | |
| 10 | `npm run check` (eslint + knip) | clean | ✅ | |
| 11 | Live smoke: `--sample confirmed --n 2` against real reports | 2 records with evidence, real files untouched | ✅ | hash-verified |
| 12 | Live smoke: `--queue` against real reports | 130 records, audit notes on demoted, "In My Way" shows resolution text | ✅ | hash-verified |

**Tier:** **verified-in-test** — deliberate controlled runs + live
read-only smoke against real `.cache/` reports (real overrides.json and
library-cache.json proven untouched by sha256 hash). Graduates to
verified-in-use when #30's ratification run promotes real buckets and
Josh spot-checks a promoted record in the loaded library.

### Follow-ups

- [x] Two judgment forks — ruled 2026-09-24: flags blessed, notes
  attached (see 2026-09-24 entry).
- [ ] File at 315 lines with 3 modes — extract `triage-views.js` on next
  touch (standards 200-line checkpoint).
- [ ] `usage()` lists only promotable buckets; sample mode accepts 9 — a
  user who typos a view-only bucket sees a misleading footer. Nit.

---

## Session: 2026-09-10 (deterministic check tooling: ESLint + knip + workspace guard hooks)

### What changed

1. **Check tooling** (`db8fb25`) — `knip.jsonc` (declares real entry
   points: HTML-loaded frontend, /libs/ runtime-served deps, CLI
   scripts), ESLint 9 flat config (js recommended + eslint-plugin-promise
   + eslint-plugin-n, Node/browser globals split), `engines.node >=24`
   declared, `no-process-exit` off for `scripts/` only. `npm run check`
   = `eslint . && knip`; `npm run lint` added.
2. **Two lint-driven fixes** (same commit) — `cdg-read.js` JSON-parse
   rethrow now carries `{ cause: err }`; `events.js`
   intentionally-ignored SSE write failure now a bare `catch`.
3. **Workspace guard hooks** (workspace root, not this repo) —
   PostToolUse scoped lint on every agent edit of a check-enabled repo +
   PreToolUse lock on checker configs. Detail: [[guardrail-hooks-live]]
   memory + workspace `docs/research/deterministic-guardrails-for-ai-code.md`.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm run check` | eslint + knip both green | ✅ | first runs of each tool = 100% false positives until config declared the repo's real topology |
| 2 | `npm test` post-fixes | 74/74 | ✅ | |
| 3 | Hook: clean-file edit | silent, ~1.2s | ✅ | within <2s per-edit budget |
| 4 | Hook: live Write of lint-failing file | blocked, error text fed back to Claude | ✅ | Windows freeze bug (#23766) did not reproduce |
| 5 | Hook: suppression directive in file | exit 2 + fix-or-ask-Josh policy msg | ✅ | |
| 6 | Hook: live Edit of eslint.config.js | PreToolUse block before edit lands | ✅ | |

**Tier:** check layer **verified-in-test** (deliberate controlled runs,
including live in-session hook firings). Graduates to verified-in-use
when it catches a real finding during feature work.

### Follow-ups

- [ ] Hooks fail open (a broken hook script = silent no-checking) —
  occasionally poke with a deliberate bad edit to confirm the layer
  still fires.

---

## Session: 2026-09-01 (gig-share flow live run + launcher URL-display fix)

### What changed

1. **start-sharing.cmd share-URL display fix** (`e01e896`) — Cloudflare's
   account-less-tunnel notice (new boilerplate) contains `https://`
   cloudflare.com links, so the display `findstr "https://"` printed the
   notice instead of the share URL. Fixed to `findstr "trycloudflare.com"`
   (same pattern the wait loop already used).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Bare-started server (`node server/index.js`) hit at `/dj` | 200 — auth off, confirms bare start is not tunnel-safe | ✅ | caught pre-tunnel; restarted via launcher |
| 2 | Launcher run → tunnel URL through real internet | audience page 200, no login | ✅ | verified-live |
| 3 | `/dj` through the tunnel | 401 until Basic Auth | ✅ | verified-live |
| 4 | stop-sharing.cmd | port 3000 free, cloudflared gone | ✅ | |

**Tier:** the sharing flow (auth gate + tunnel) is **verified-live**. The
URL-display fix itself is **verified-in-test** only (the fixed pattern
matched exactly one line in the live run's tunnel.log; the patched script
hasn't produced a live run yet).

### Follow-ups

- [ ] Next start-sharing.cmd run: confirm the SHARE THIS URL box prints
  the actual trycloudflare.com URL (closes the fix at verified-in-use).

---

## Session: 2026-08-31 (ch.4 lens pass → queue advance + dedupe #23/#24 — all verified-live)

### What changed

1. **Server-side atomic queue advance** (`b08d0da`) — Ousterhout ch. 4
   (deep modules) lens pass finding: "play the next song" was a non-atomic
   client compound (GET/inspect/DELETE, status unchecked); two DJ tabs
   hitting Skip could double-play the head. New `advanceQueue()` +
   `POST /api/queue/advance` (drops stale entries server-side);
   `djAdvance()` shrank ~33 → ~14 lines. Also unlocks future
   now-playing/history (server finally learns a song started).
2. **Grouping key: &/and ignored + artist tokens sorted** (`2369de2`, #23,
   ADR 0003) — Josh reported real search duplicates. 39,138 → 38,100 raw
   groups (1,038 dupes gone; 37,794 live with overrides). Full-cache merge
   sim + human screen of all clusters (0 false merges) + Codex adversarial
   pass before shipping; fold-&-variant rejected after it split 37 groups.
   CACHE_VERSION 3 → 4.
3. **Version lists collapse same-disc copies; blank-disc rows show
   filename** (`6b9ed9d`, #24) — renamed same-discCode rips across packs
   showed as duplicate version rows (LG071-02 ×2); bare "—" on blank-disc
   rows. Dedupe key = non-blank discCode, else filename; lowest-id
   survivor; per-file ids all stay playable.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `queue.advance.test.js` concurrent-advance race vs old client workflow | red (double-play) | ✅ red pre-fix | "both advances played song-a" |
| 2 | Same test vs `POST /advance` | green: distinct songs, N advances consume N | ✅ | + stale-skip test |
| 3 | #23 key tests (name-order, &/and/absent, anti-split, title order kept) | red → green | ✅ | fold-& variant caught splitting 37 groups pre-ship |
| 4 | #24 dedupe tests (discCode collapse, blank-disc filename fallback, order-independent survivor) | red → green | ✅ | spec iterated once — see below |
| 5 | Full suite | all green | ✅ 74/74 | was 64 |
| 6 | `npm run measure` | parser baseline unchanged | ✅ | 839 raw / 34 inversions |
| 7 | Live: "Endless Love" post-rescan | duet = 1 row / 3 versions; solo Richie flat; no "—" | ✅ | |

**Tier: verified-live** (#23 + #24 confirmed on the running site, issues
closed at that tier). Queue advance is **verified-in-test** — its live
half is trivially exercised at the next real Skip.

### Left open

- #21 tiers awaiting Josh's browse-and-rule (unchanged from 08-26).
- Lens-pass suspicions not yet ratified: `loadLibrary()` returning parts
  (index.js finishes assembly — small deepening win); `songsById` threading.
  Deferred with triggers: feat-clause dedupe (~47 dupes, marker in
  `makeSongKey`); hyphen-variant artists still split.
- Pipeline note (#24): first full **Fable-tests → Codex-implements →
  Sonnet-reviews → Fable-verifies** run. Live verify caught a spec miss
  green tests couldn't (byte-copy vs renamed-copy) — the look-leg stays
  human/Fable. Codex background mode orphaned once; foreground is the
  standing rule (memory: codex-background-jobs).

---

## Session: 2026-08-26 (#21 Stage 1 harvest — 290 auto overrides applied, hard failures 839 → 419)

### What changed

1. **Overnight batch read finished** — the 2026-07-18 run had silently stopped at
   ~485/554; resumed and completed this session (checkpoint made it free).
   Final: **554/554 files, 542 title cards found, 9.3s/frame**. Six files whose
   frames the model could never parse were parked as unreadable (they land in
   the unmatched tier honestly). `scripts/cdg-read.js` gained an env-overridable
   `FRAME_TIMEOUT_MS` (tail-end sweeps at 75s instead of 180s).
2. **`scripts/cdg-harvest.js` NEW** (matcher, pipeline piece 4) — matches card
   reads against the named library (exact title, then prefix for Top Tunes
   truncation), cross-confirms artist via the file's own filename tokens or the
   card's "in the style of" line, and stages tiered proposals in
   `.cache/stage1-proposals.json`. `--apply <tiers>` is the manual promotion
   gate into overrides.json. Bug caught in spot-check: tokenizing with
   `normalizeSongField` welded dash-packed filenames into one token — fixed
   with a spacing tokenizer (Matt Cardle case: review → auto, correctly).
3. **Josh ratified the auto tier** — 290 proposals merged into overrides.json
   (17 → 307 entries).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Spread sample of auto tier (every 18th, 16 entries) | all proposals correct on eyeball | ✅ | incl. filename-typo catch: `SC7513_02_Carly_Perkins` → Carl Perkins via card artist |
| 2 | `--apply auto` dry run | merges then reverts clean via git | ✅ | first attempt exposed unwired `--apply` (ran a harvest instead) — fixed, retested: 275 merged, diff inspected, reverted to 17 |
| 3 | Post-apply library load (server path: loadOverrides → applyOverrides) | hard failures drop | ✅ | **426 entries corrected; no-artist 839 → 419; unique failing filenames 554 → 251** |
| 4 | `npm test` | 64 green | ✅ | 64/64 |
| 5 | `npm run measure` | parser baseline unchanged (overrides aren't parser credit) | ✅ | 839 raw hard failures, 34 flagged inversions — matches canonical baseline |

### Left open

- Tiers awaiting Josh's browse-and-rule: **likely 70** (single candidate,
  unconfirmed), **review 84** (multiple candidates / truncated match),
  **unmatched 97** (85 with a card title but no library twin — override
  material with filename judgment; 12 unreadable). All staged in
  `.cache/stage1-proposals.json`.
- Op note: sandbox-backgrounded reader processes get throttled AND my Git Bash
  `kill -0` liveness checks can't see Windows PIDs — at one point three
  readers raced on the checkpoint (9 contaminated null-reads purged, re-read
  clean). Run readers foreground; check liveness via PowerShell.

---

## Session: 2026-07-18 later (#22 reader fixes — Stage 0 gate CLOSED; Stage 1 launched)

### What changed

1. **`scripts/cdg-read.js` fixes** (branch `issue-22-reader-gate`, #22) —
   frame-selection fallback now picks the title seen on the most frames,
   tie-break to the later frame (`pickMostSeenTitle`), instead of
   `candidates[0]`; prompt no longer treats a logo as disqualifying (Music
   Maestro prints the title under its logo).
2. **Stage 1 plumbing** (#21) — `--from-failures` on the snapshot camera (all 839
   no-artist songs from the cache); reader `--out` report checkpointed after
   every file (tmp-then-rename, atomic) and resumable — files whose frames
   only errored are retried on resume, not skipped (code-review catch).
3. **Frames regenerated** for the 17 knowns + **all 839 hard failures
   snapshotted** (`--from-failures --scan`: 839/839 OK, 3,966 frames,
   `.cache/stage1-frames/`).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `PHM0204-08` (frame-selection bug) | reads "Wrong Impression" | ✅ | most-seen title beat the t4 "Pop Hits" banner; picked t8 |
| 2 | `mm6018-04` (logo-rule bug) | reads "My Prayer" | ✅ | title-under-logo card accepted; artist UNCONFIRMED by design (MM prints songwriters) |
| 3 | Re-score 17 knowns, strict | ≥95% or every miss explained + accepted | ✅ | **15/17 (88.2%)** — the two misses are the known accepted pair: override drops "The" (`sc8574-07` card reads "The Grand Illusion"); `TU067-16` Top Tunes truncation. Josh accepted both this session → **Stage 0 gate CLOSED** |
| 4 | Throughput | ≤ prior 13.7s/frame | ✅ | **12.9s/frame, 44.7s/file** — Stage 1 projects ~5–10h |
| 5 | Resume smoke test | skip done files, retry errored, re-read missing | ✅ | doctored checkpoint: 14 skipped, fake-errored file retried, dropped file re-read; final numbers identical (15/17) |
| 6 | No regressions on the other 13 knowns | all still MATCH | ✅ | every previously-passing file unchanged |

**Verified-in-test.** Promotes to verified-in-use when Stage 1's batch runs
against real unknowns and Josh ratifies proposals.

Evidence: scored report kept at `.cache/calib-rerun-2026-07-18.json`
(gitignored, regenerable ~13 min). `overrides.json` and the library never
written to.

### Follow-ups

- **Stage 1 batch read launched overnight** over the 3,966 frames →
  `.cache/stage1-reads.json` (checkpointed, resumable). Next session:
  partial-title matching of the raw reads against the library, then
  proposals for Josh.
- `TU067-16`'s card frames consistently return empty model answers (thinking
  model quirk) — it will retry on every resume; harmless, known truncation
  limit anyway.
- Stage 2 comparator must tolerate fuller-than-override cards (leading
  "The", duet credits) — carried from the previous session's follow-up.
---

## Session: 2026-07-18 (#21 Stage 0 reader calibration — vision measured)

### What changed

1. **`scripts/cdg-read.js`** (uncommitted, #21) — pipeline pieces 2+3: reads
   snapshot frames with local `qwen3-vl:8b` via Ollama, compares against a
   truth file, writes a scored report. No new deps. Read-only over the
   library; writes only its own `--out` report.
2. **Frames regenerated** for the 17 known-truth overrides (`--scan
   --from-overrides`, 120 frames, 3s) — the Stage 0 camera output from
   2026-07-17 was not kept on disk.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Reader returns parseable JSON per frame | clean JSON every frame | ❌→✅ | Ollama `format:"json"` made this thinking model emit everything as `thinking` and return an empty `response`; fixed by asking for JSON in the prompt and parsing it out |
| 2 | Score 17 knowns, strict title match | ≥95% (Stage 0 gate) | ❌ | **76.5%** (13/17). Gate not met — but no failure is a misread; see #3 |
| 3 | Verbatim accuracy where the real card was located | model transcribes what's printed | ✅ | **15/15.** Two "mismatches" are the model being *more* correct than `overrides.json` (card says "The Grand Illusion"; "BING CROSBY with GRACE KELLY") |
| 4 | Throughput per frame | ~2.5 min (dense-screenshot prior) | ✅ | **13.7s/frame, 51.4s/file, 2.5 frames/file** — Stage 1 (843 files) projects to ~5–12h, one overnight, not 35h |
| 5 | Re-verify `90210-11` (open follow-up) | card confirms or refutes freedb | ✅ | Card reads TRUE LOVE / BING CROSBY with GRACE KELLY — freedb entry confirmed, duet credit was the part we dropped |
| 6 | Frame selection picks the real title card | title card, not label banner | ❌ | `PHM0204-08`: model read "Wrong Impression" correctly at t6 **and** t8; the first-candidate fallback picked the t4 "Pop Hits" disc banner |
| 7 | Music Maestro card readable | title read (artist absent by design) | ❌ | `mm6018-04` frame plainly shows "My Prayer", but the prompt's "a logo means not a title card" rule made the model reject it — MM prints the title *under* its logo |

**Verified-in-test** (controlled run against known truth, GPU free,
llama-server down). Promotes to verified-in-use when Stage 1 runs against
real unknowns and Josh ratifies a batch of proposals.

Evidence: the numbers above plus the per-file breakdown in the issue #21
comment of 2026-07-18. The scored JSON report was a scratch artifact and was
not kept — re-runnable in ~25 min. `overrides.json` and the library were
never written to.

### Follow-ups

- **Two reader bugs block the Stage 0 gate** — frame-selection fallback (#6
  above) and the logo rule (#7). Both fixable without touching the model;
  tracked as [issue #22](https://github.com/Burdchrome/karaoke-platform/issues/22).
  Re-run the same 17 after fixing; gate closes at verified-in-test.
- **Top Tunes discs truncate on screen** — `TU067-16` renders "I Haven't
  Played This... (Am)". No reader can recover the full title from the
  pixels; Stage 1 needs a partial-title match against the library or these
  stay unresolved.
- **`overrides.json` is a simplification in at least 2 of 17 entries**
  (missing "The", missing duet credit). Not wrong, but Stage 2's audit will
  flag cards like these as mismatches — decide then whether the override or
  the card is canonical.
---

## Session: 2026-07-16/17 (#8 rescue round + #21 Stage 0 camera)

### What changed

1. **overrides.json 4 → 17 entries** (bf3d65b, #8) — freedb-dump grep
   cross-checked against library siblings (method:
   `docs/research/freedb-rescue-results-2026-07-16.md`); 3 entries confirmed
   by Josh's ear on CDG title cards (CB 7002 pair = Elvis gospel disc
   CB70002; esp451-4-04 = George Jones).
2. **`scripts/cdg-snapshot.js`** (bf3d65b, #21) — CDG → PNG camera; fixed
   `--times` + change-detection `--scan` modes, no new deps.
3. **Rescue helper scripts** committed to `scripts/` (extract-code-only /
   find-siblings / verify-overrides).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm test` | all green | ✅ | 64/64, unchanged |
| 2 | verify-overrides vs cache | every key matches real filenames | ✅ | 17/17 apply; 16/17 have a same-song library twin |
| 3 | Server load | overrides applied, grouping merges | ✅ | "Applied 34 manual overrides"; Elvis pair groups with CB70002 twins (4 files each) |
| 4 | Search API + UI | corrected names surface | ✅ | "cb 7002" → 2 correctly-named matches, live in app |
| 5 | Snapshot camera | frames for all 17 knowns | ✅ | 17/17, 0 failures, seconds of wall time |
| 6 | Scan mode catches late/early cards | SC title card captured | ✅ | SC card at ~t2s (fixed times missed it); MM cards lack performer artist — comparator caveat |

Verified-in-test (scripts, API) + verified-in-use for the 3 ear-confirmed
entries (Josh read the CDG screens in the running app). Reader-accuracy
calibration NOT run — GPU held by llama-server, Josh chose to defer.

### Follow-ups

- #21 Stage 0 gate: qwen3-vl scored against the 17 knowns 2026-07-18 (see
  that session). Reader is clean; gate still open on two pipeline bugs.
- `90210-11` (= Bing Crosby / True Love) rested on offset math + a cross-disc
  twin rather than an ear check — **confirmed 2026-07-18** by its title card.

---

## Session: 2026-07-15 (v4 approved; mobile nitpicks #18–#20)

### What changed

1. **`.logo` fixed → absolute** (`public/styles.css`, 8cd2c4d, #18) — polaroid
   no longer tails the scroll on mobile.
2. **AppleDouble `._` sidecars skipped in `buildIndex`** (8cd2c4d, #19) —
   14 junk songs gone; rescan 65,832 → 65,818.
3. **overrides.json: first 6 real entries** (8cd2c4d + 0b17646) — sc8811-01
   slug → U2; SC2421-06 → Eva Cassidy; the two #15 spot-check residuals
   (PHM0204-08 → Natalie Imbruglia, TU067-16 → Neil Diamond).
4. **trackNN parser round** (`server/library.js`, f28c39d, #20) — 4 shapes
   (~640 files): track folded into disc code, space-glued codes rejoined
   (dashed prefixes too), bare 00–19 track stripped with artist order
   resolved by a library-frequency check in `buildIndex`, backtracked
   pure-digit artists fail clean. CACHE_VERSION 2 → 3.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm test` | all green | ✅ | 64/64 (was 55) |
| 2 | Rescan + measure | no inversion regression | ✅ | 839 hard failures (768 + 71 junk artists like "01" now failing honestly), 34 flagged inversions unchanged |
| 3 | Grouping | fixed files merge with real versions | ✅ | 39,308 → 39,135 unique songKeys |
| 4 | List top via API | real artists, no "01 —" junk | ✅ | 'Til Tuesday → 10,000 Maniacs → 10cc; 3 stragglers noted in #20 close |
| 5 | Overrides live | corrected artist/title in search API | ✅ | "Applied 6 manual overrides" + both #15 residuals verified |
| 6 | Logo scroll on 375px | off-viewport after scroll | ✅ | getBoundingClientRect check |
| 7 | Numeric-artist guards | 98 Degrees / 50 Cent / 10cc untouched | ✅ | unit-tested + eyeballed in list |

Verified-in-test + verified-in-eyeball (Josh, phone via tunnel — v4 look and
the fixed list). Browser-pane screenshot capture confirmed broken at the app
level (input/read actions fine, capture hangs) — see memory
`browser-pane-capture-hang`; verify via read_page/JS until fixed.

### Follow-ups

- 3 list stragglers (`04' - John Anderson`, 2× "Hits From Hair") — overrides
  candidates if they bother anyone; logged in #20's close comment.

---

## Session: 2026-07-14 (design v4 "the scratched wall")

### What changed

1. **`public/styles.css` fully replaced (v3 → v4)** — chalk-silver ink on
   neutral black, red neon as the only glow, amber demoted to DJ-only,
   cream reserved for paper objects, scratched-line texture, `'26` wordmark
   year tag. All selectors preserved; no HTML/JS touched. System doc:
   root `DESIGN.md`.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Server boot + audience page load | No console errors, list renders | ✅ | 65,832 songs from cache |
| 2 | New tokens live | chalk ink / neutral bg / silver borders / `'26` tag computed | ✅ | via computed-style JS check |
| 3 | Search "fleetwood mac" | Results + version groups render | ✅ | 49 matches, toggles present |
| 4 | 360px viewport | No horizontal overflow; wordmark fits; play-btn ≥44px | ✅ | scrollWidth 360, btn 45.5px |

Verified-in-test, structurally only — the Browser pane's screenshot capture
hung all session, so nobody has *seen* v4 rendered. Not verified-in-eyeball.

### Follow-ups

- **Josh's visual verdict on v4** — CLOSED 2026-07-15: viewed on his phone
  via tunnel, verdict "the look is great." Two nitpicks became #18/#19
  (fixed same day — see the 2026-07-15 session above).

---

## Session: 2026-07-12 (preview cap leak fix + standalone sharing stack)

### What changed

1. **Preview cap leak closed** (`public/app.js`, f45b51e) — one-shot
   `previewCapped` flag removed; `enforcePreviewCap` runs on every
   `timeupdate` and `play`, and `seeking` past 30s clamps back to the
   boundary. Cap remains client-side by design (DJ side untouched).
2. **Standalone sharing scripts** (`start-sharing.cmd` / `stop-sharing.cmd`)
   — server + Cloudflare tunnel as independent windows, decoupled from any
   Claude session (the session-tied dev server died twice mid-share and
   502'd the tunnel; that's what motivated these).

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | Audience: scrub to 45s during preview | Clamp to 30s, pause, hint swaps | ✅ | in-browser JS: `currentTime` 45→30, `paused: true`, "Preview ended" hint |
| 2 | Audience: press play again after cap pause | Re-pauses immediately at 30s | ✅ | old replay bypass closed |
| 3 | `start-sharing.cmd` end-to-end | Server + tunnel up, URL printed | ✅ | audience 200 via tunnel; needed ~15s for tunnel to register |
| 4 | `/dj` through tunnel, no creds | 401 | ✅ | with creds: 200 |
| 5 | `stop-sharing.cmd` teardown path | Tunnel + port 3000 clear | ✅ | verified via taskkill/netstat (same commands the script runs) |

Verified-in-test; becomes verified-in-use after a real multi-hour share
session (the cap under real audience behavior, the stack under a gig).

### Follow-ups

- DJ Basic Auth creds live in `dj-creds.cmd` (gitignored, machine-local;
  `start-sharing.cmd` calls it and errors helpfully if it's missing).
  Recreate it on any new machine before sharing.

---

## Session: 2026-07-10c (tickets #12 + #13 — songKey, cache v2, overrides)

### What changed

1. **songKey + versionLabel** (`server/library.js`, #12, ed7eac1) —
   `normalizeSongField` (lowercase/collapse → fold The both positions →
   strip punctuation) + `makeSongKey` (trailing title parens → versionLabel).
   Every cache entry carries both fields.
2. **Cache schema v2** (#12) — `"version": 2` written; v1/unversioned cache
   on load → auto full rescan. `npm run rescan` alias (`--rescan` flag;
   cmd.exe can't do the `VAR=1` prefix). Spec §2 errata: literal normalize
   order can't execute (punct-strip eats the comma `, The` needs).
3. **overrides.json consumed** (#13, 4439bc1 + 9c7bd51) — id/filename →
   `{artist, title}`, applied in memory on both load paths; cache stays raw.
   Review fix: half-written entries (missing title / string value) skip with
   a warning instead of crashing makeSongKey; non-ENOENT read errors logged.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm test` | all pass | ✅ | 47/47 (was 27) |
| 2 | `npm run rescan` (real E:\karaoke) | v2 cache, all fields | ✅ | 65,832 songs, 0 missing songKey/versionLabel, 39,313 unique keys |
| 3 | v1 cache on load | auto-rescan | ✅ | fixture library end-to-end: stale cache ignored, v2 written |
| 4 | "Dreams" grouping | multi-disc group, no merges | ✅ | Fleetwood Mac ×3 grouped; 9 distinct "Dreams" separate |
| 5 | `npm run measure` post-rescan | 772 / 34 unchanged | ✅ | exact — no regressions |
| 6 | live override (sc_8537-01, cached load) | applied + regrouped | ✅ | log "Applied 1 manual overrides"; songKey → `don williams\|stay young`; test entry reverted, ships `{}` |

Verified-in-test throughout; becomes verified-in-use at the first real gig
on the v2 cache. #15 (acceptance) is the formal re-proof.

### Follow-ups

- `library.js` ~460 lines — split the overrides functions into their own
  module next time the file is open for other work.

---

## Session: 2026-07-10b (tickets #10 + #11 — parser fixes)

### What changed

1. **Comma-shape inversion fix** (`server/library.js`, #10, 16f855f) — within
   title-first packs, exactly one "Last, First" segment wins as artist over
   the prefix table. Scoped after a global run misfired on ~1,100 clean-pack
   comma-shaped titles ("Walk, The").
2. **Stray-space + underscore passes** (#11, ebad900) — underscores translate
   to spaces; a 4-rule pre-pass rejoins space-fragmented disc codes
   ("SC 8385-15", "CB6084 09", "sc 8119 - 02", "sc 8795-03-tight"). Pass-4
   fallback now returns the original filename.
3. **Consolidation** — `TITLE_FIRST_PREFIXES` + `isPersonNameShaped` now live
   only in `library.js`; measurement script imports them. Parser tests in
   `server/library.test.js`; `npm test` covers `server/` too.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm test` | all pass | ✅ | 27/27 (13 parser + 14 measurement) |
| 2 | cache re-parse: inversions | ≈ 0 | ✅ | 512 → **34**, all both-shaped ties → #13/#8 |
| 3 | cache re-parse: hard failures | drop ~96 | ✅ | 875 → **772** (−103) |
| 4 | regression: artist lost | 0 files | ✅ | checked file-by-file vs old cache; 103 gained |
| 5 | code-only stray-space file | still fails cleanly | ✅ | "CBEP 454-1-06" → #8's list |

Verified-in-test: re-parse of cached filenames in memory — the on-disk cache
is still v1/stale until the #12 rescan. #15 (acceptance) re-proves against the
rebuilt cache; becomes verified-in-use at the first real gig after rescan.

### Follow-ups

- sc_8537 disc is title-first order inside the SC pack — mechanism proven in
  #13 (session 2026-07-10c, test 6, verified-in-test on track 01); actually
  populating overrides for the disc is issue #8's manual-rescue work.

---

## Session: 2026-07-10 (ticket #9 — parse-coverage measurement script)

### What changed

1. **`scripts/measure-parse-coverage.js`** — ticket-#3's scratchpad measurement,
   now permanent. Reads `library-cache.json` (read-only), reports coverage %,
   six failure buckets with samples, per-prefix inversion table.
2. **`scripts/measure-parse-coverage.test.js`** — 8 node:test tests at the
   classifier seam, real corpus filenames.
3. **`package.json`** — `npm test` and `npm run measure` aliases.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm test` | 8/8 pass | ✅ | node:test, zero new deps |
| 2 | `npm run measure` vs #3 baseline | 98.7% artist-present, 875 failures | ✅ | both exact |
| 3 | inversion count | ~450 | ⚠️ | **512** (DKM 326, ZMP 108, TU 74) — wider regex than the lost scratchpad; pinned as canonical baseline in the script header |

Verified-in-use 2026-07-10: #10 and #11 both measured against this baseline
(session 2026-07-10b above).

### Follow-ups

- Consolidate `TITLE_FIRST_PREFIXES` + name-shape regex — done in #10
  (16f855f): both live in `library.js`, script imports them.

---

## Session: 2026-07-07c (dedupe at load)

### What changed

1. **Dedupe at load** (`server/index.js`) — after sorting, one pass keeps the
   first copy per artist+title (blank artists key on filename) and counts the
   rest as `versions`. Cache untouched — delete the block + restart to undo.
2. **`versions` exposed** in `/api/songs` results.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `/api/health` | songCount drops to ~43k | ✅ | 65,832 → 43,335 |
| 2 | search "set fire to the rain" | 1 row, versions=12 | ✅ | was 12 rows |
| 3 | stream kept copy | plays | ✅ | HEAD on /api/stream/:id/cdg ok |

### Follow-ups

- Version picker (choose disc per song) deferred until Shooter asks —
  `ponytail:` comment marks the spot in index.js.

---

## Session: 2026-07-07b (extraction remainder + sort)

### What changed

1. **Ran `extract-zips.js` over all 3,637 zips** — 3,633 ok, 4 corrupt
   (truncated downloads, listed in `extract-zips.log`).
2. **Forced rescan** — library went 65,672 → **65,832** (+160). The old
   "3,477 packs unextracted" claim was stale; the remainder was tiny.
3. **Sort at load** (`server/index.js`) — songs sorted artist → title once
   at startup; blank-artist entries sort last.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | rescan | cache rebuilt, count grows | ✅ | 137,757 files walked, 65,832 paired |
| 2 | `GET /api/songs?limit=5` | alphabetical, not disk order | ✅ | |
| 3 | search "set fire to the rain" | dupes adjacent | ✅ | 12 copies incl. same-disc repeats (MRH81-17 ×4) |
| 4 | `/api/health` | songCount 65,832 | ✅ | |

### Follow-ups

- Dedupe decision open: same-disc-code repeats (folder copies) are safe to
  collapse; different-disc-code copies may be different arrangements — ask Shooter.

---

## Session: 2026-07-07 (ponytail review cleanup)

### What changed since last verified state

1. **`DELETE /api/queue` — one-shot clear** (`server/routes/queue.js`, `public/app.js`)
   - Server's existing `clearQueue()` finally has a route.
   - DJ "Clear all" now sends 1 request instead of fetch-queue + N deletes.
2. **`stream.js`** — Content-Type header only set for `.cdg` (sendFile infers mp3).
3. **`library.js`** — removed unused `depth` param from `walk()`.
4. **Repo** — deleted 4 `Visual Board` JPGs that were byte-identical to `public/img/`.
5. **README** — fixed drift: auto-advance is manual-skip by design (was listed
   as auto); DJ auth exists (was listed as deferred); added `DELETE /api/queue`
   to API table; added "HOWTO: add new songs" and a documentation map.

### Test cases

| # | What | Expected | Pass/Fail | Notes |
|---|------|----------|-----------|-------|
| 1 | `npm start` (port 3456) | Boots from cache | ✅ | 65,672 songs, `/api/health` ok |
| 2 | POST two songs to queue | queue length 2 | ✅ | via API |
| 3 | `DELETE /api/queue` | returns `removed: 2`, queue empty after | ✅ | new endpoint |
| 4 | `node --check` on all edited JS | no syntax errors | ✅ | |

Not re-run: browser UI flows (search/play/drag) — untouched by these changes
except the Clear All button, which now hits the verified endpoint.

### Follow-ups

- Test 11 in the 2026-05-24 session ("auto-advances on song end") describes
  removed behavior — auto-advance is intentionally off. Don't re-run it as written.

---

## Session: 2026-05-24

### What changed since last verified state

1. **30-second preview cap for audience side** (`public/app.js`)
   - Audience page (`/`) now closes the player at 30s of playback.
   - DJ page (`/dj`) unchanged — full playback.
   - Implementation: `timeupdate` listener that calls `closePlayer()` when `currentTime >= 30`.

2. **Refactor — `formatSongLabel` helper** (`public/app.js`)
   - One function builds the "Artist — Title • Requester" label.
   - Replaces 4 duplicated spots: `renderResults`, `renderQueue`, `djAdvance`, `updateUpNext`.
   - **Behavior change:** "On Deck" indicator now shows `• Requester` instead of `(Requester)`. Bullet style wins across the board.

3. **Refactor — `resetAudio` helper** (`public/app.js`)
   - One function for "tear audio down to clean state" (stop loop, pause, clear src, null cdg, clear canvas).
   - Replaces duplicated teardown code in `openPlayer` and `closePlayer`.
   - **No expected behavior change.** Pure code consolidation.

### Environment

- [x] `E:\karaoke` mounted, contains `.cdg`/`.mp3` pairs
- [x] `library-cache.json` exists (no rescan needed)
- [x] Server boots cleanly via `npm start`
- [ ] DJ creds set (`DJ_USER` / `DJ_PASS`) — **intentionally skipped this run** (local-only test)

### Test cases

| # | Page | What to do | Expected result | Pass/Fail | Notes |
|---|------|-----------|----------------|-----------|-------|
| 1 | server console | `npm start` | Log: "Karaoke server listening on http://localhost:3000". Library loads from cache (instant). | ✅ | 65,672 songs loaded from cache, server up. `/api/health` returns ok. |
| 2 | `/` (audience) | Page loads | Search box, status line "65,672 songs total (showing 50)." or similar, list of songs. No "+ Queue" buttons. |  |  |
| 3 | `/` | Type a search query (e.g. "adele") | List filters live. Status updates to "N matches (showing 50)." |  |  |
| 4 | `/` | Click ▶ Play on a result | Player opens. Audio starts. Lyrics render on the canvas. Label shows "Artist — Title" (or just title if artist unknown). |  |  |
| 5 | `/` | Let playback continue past 30s | Player auto-closes at ~30s. Audio stops. | ✅ |  |
| 6 | `/` | Open player, drag scrubber past 30s | Player closes immediately (since currentTime jumps past threshold). |  |  |
| 7 | `/` | Press Esc while player open | Player closes. Audio stops. |  |  |
| 8 | `/dj` | Page loads | Same as audience + queue panel, singer name input, "+ Queue" buttons on each row. |  |  |
| 9 | `/dj` | Type a singer name, click "+ Queue" on a song | Song appears in queue panel. Singer name persists on reload. |  |  |
| 10 | `/dj` | Play a queued song via the ▶ in the queue | Player opens, song plays in full (no 30s cap), entry removed from queue. | ✅ |  |
| 11 | `/dj` | Let a queued song play to the end | Auto-advances to next queue entry. Player stays open. |  |  |
| 12 | `/dj` | Drag-to-reorder a queue entry | Order updates. Survives a page reload. |  |  |
| 13 | `/dj` | Check "On Deck" text when a song is queued | Reads "On Deck: Artist — Title • Singer" (bullet, not parens). | ✅ |  |
| 14 | `/dj` | Click Clear All | Queue empties. |  |  |

### Result summary

**Critical-path tests passed:** 1, 5, 10, 13.

- Server boots clean.
- 30-second audience cap fires correctly (test 5).
- DJ playback unaffected by the cap — full songs play through (test 10).
- `formatSongLabel` refactor produces the expected bullet-style "On Deck" label (test 13).

Tests 2–4, 6–9, 11–12, 14 not run this session — they cover pre-existing functionality untouched by the changes. Run them next session if anything in that surface area gets modified.

### Issues found

(filled in after the run — even minor things; this is where the iteration loop pays off)

### Follow-ups

(things noticed during the run that aren't bugs but are worth doing later)
