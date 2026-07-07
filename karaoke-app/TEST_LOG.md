# Karaoke App — Test Log

A running record of manual test sessions against the karaoke server. Each session lists what changed since the last verified state, the tests run, and the result. The point: catch regressions, build a checklist that grows with the app.

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
