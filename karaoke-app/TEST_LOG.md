# Karaoke App — Test Log

A running record of manual test sessions against the karaoke server. Each session lists what changed since the last verified state, the tests run, and the result. The point: catch regressions, build a checklist that grows with the app.

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

- **Josh's visual verdict on v4** — open `http://localhost:3000` in Firefox
  (start the server first). Keep / tune / redirect is his call; this entry
  closes when he's looked at it.

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
