# Karaoke DJ Project — Master Handoff

**Last updated:** 2026-05-15
**Supersedes:** `karaoke_dj_handoff.md` (older — pre-inventory, contained open questions now answered)
**For:** Shooter (Shaeder), a karaoke DJ the user knows personally

---

## What we're building

A **self-hosted local karaoke platform**. The DJ's laptop runs a small web server during gigs. Audience members (and the DJ) connect from any device on the same Wi-Fi to a web page that lets them:

- Browse the song library
- Search by artist or title
- Preview / listen to songs

Later phases add queue management, DJ controls, and library cleanup tools.

**Non-critical to be always-on.** Server starts when the laptop boots before a gig and stops when the gig ends.

---

## Hardware

- **Server machine:** HP 14-dx0002dx laptop (user's)
- **Storage:** 2TB external USB drive, mounted as `E:\` on Windows
- **Library root:** `E:\karaoke\`
- **Network:** Local Wi-Fi (DJ's laptop is the host; phones are clients)

---

## Library inventory (scanned 2026-05-15)

| Item | Count | Size |
|---|---|---|
| **Paired songs (CDG + MP3, both present, matching names)** | **65,672** | ~330 GB |
| MP3s without a matching CDG | ~143 | mostly sound effects in `old stuff\` |
| CDGs without a matching MP3 | <52 | real songs — recoverable later |
| ~~Unextracted `.zip` packs~~ | **EXTRACTED 2026-05-15** | 3,473 of 3,477 succeeded; 4 corrupted zips logged |
| MP4 video karaoke | 6 | Halestorm + Taylor Swift — different format |
| Junk shortcuts (`.lnk`) pointing to a missing drive | 25 | safe to delete |
| Miscellaneous noise (`.dll`, `.bat`, Winamp leftovers) | ~75 | ignore |
| **TOTAL FILES ON DRIVE** | **130,209** | **338 GB** |

**Headline:** the playable library is already larger than KaraFun's commercial catalog (~57k songs).

**Full report:** `Karaoke Project/karaoke_inventory.txt` (same folder as this doc)

---

## File format: CDG + MP3

- **MP3** = audio (instrumental backing track)
- **CDG** = synced lyric graphics (CD+Graphics standard, paired with the MP3)
- Each playable song = two files with the same basename in the same folder, e.g.
  - `ABBA - Dancing Queen.mp3`
  - `ABBA - Dancing Queen.cdg`

**Why this matters for architecture:**
- Jellyfin and other generic media servers **cannot render CDG**. They'd play the MP3 with no lyrics, which is not karaoke. So we are **not using Jellyfin.**
- Browsers can play MP3 natively (`<audio>`) and render CDG via the open-source `cdgraphics` JS library to a `<canvas>`. So a custom web app is the right path — and it's not as much code as it sounds.

---

## Architecture (decided)

```
┌──────────────────────────────────────────────┐
│  HP 14 laptop                                │
│                                              │
│  Node.js + Express server  (port 3000)       │
│  ├─ Scans E:\karaoke once on startup         │
│  ├─ Holds song index in memory               │
│  ├─ GET /api/songs?search=...                │
│  ├─ GET /api/stream/:id/:type  (mp3 or cdg)  │
│  └─ Serves static web UI from /public        │
│                                              │
│  Web UI (HTML + JS, no framework yet)        │
│  ├─ Search box                               │
│  ├─ Song list                                │
│  ├─ <audio> for MP3                          │
│  └─ <canvas> + cdgraphics for CDG            │
└──────────────────────────────────────────────┘
            ↓ USB                ↑ Wi-Fi
   ┌──────────────┐    ┌────────────────────┐
   │ E:\karaoke\  │    │ Phones / tablets   │
   │ 62k songs    │    │ http://laptop:3000 │
   └──────────────┘    └────────────────────┘
```

### Why this stack

- **Node + Express:** small, easy to read, huge ecosystem, ADHD-friendly because errors are obvious
- **No frontend framework (yet):** plain HTML/JS for v0 — fewer moving parts, faster first run. Add React only when it's actually needed
- **No database (yet):** library is scanned into memory at startup; SQLite added later if queue/history needs persistence
- **Winston logger:** structured logs so debugging during a gig is possible
- **Jest for tests:** added once there's logic worth testing (queue management, search relevance)

---

## Phases

**✅ Phases 0–2 shipped** — see [Current State](#current-state-as-of-2026-05-15-end-of-session) below for full detail.

### Phase 3 — Library cleanup
- [ ] Extract the 3,477 zip files (each is one more song)
- [ ] Try to match the 52 CDG orphans to MP3s elsewhere on the drive
- [ ] Decide what to do with the 6 MP4 video karaoke files
- [ ] **Metadata cleanup pipeline** (see spec below)
- [ ] Dedupe songs that exist under multiple disc codes (rolled into the metadata pipeline)

#### Phase 3 spec — metadata cleanup pipeline

**Do not start until Phase 1 (v0 player) and Phase 2 (queue management) are shipped.**

**Problem.** The current artist/title extraction is a single regex in `server/library.js` (`parseFilename`) that only handles `DISCCODE - Artist - Title`. The library has at least five naming conventions:

1. `DISCCODE - Artist - Title` — parsed correctly (~50% of library)
2. `DISCCODE - Title - Artist` — parsed but **swapped** (A/M/G-prefix disc codes)
3. `Artist - Title - NumericDiscCode` — falls through as unknown artist + raw title
4. `NN.-Artist-Title-(DISC)` Sunfly Hits packs — falls through
5. Free-form names with no disc code — falls through

Plus duplicates: same song appears under multiple disc codes (e.g. "Can't Hold Us" under A27606 appears twice in the inventory).

**Replace the regex with a disc-code-lookup pipeline:**

1. **Extract disc code candidates** from the filename — could appear at start, end, or in parens. Don't assume position.
2. **Look up the disc code** in a karaoke-track database. Investigate these freely-available sources and pick one:
   - karaoke-version.com (does it expose a public API?)
   - KaraoKloud
   - MusicBrainz (general, but karaoke coverage may be thin)
   - Community-maintained CSVs (search GitHub for `karaoke disc code csv`)
   - The chosen source must be documented in this handoff once decided.
3. **Cache lookups to disk** (JSON or SQLite) so a full scan doesn't re-hit the API. Cache key = disc code.
4. **Fall back to a smarter multi-pattern regex** *only* when there's no DB hit.
5. **Dedupe via audio fingerprinting** — `chromaprint` / `acoustid` for confidence. Two files that fingerprint the same are the same song regardless of disc code.

**Deliverables:**
- Rewritten `server/library.js` with the new pipeline
- A small CLI tool (e.g. `node scripts/refresh-metadata.js`) the user can run to refresh the metadata cache without restarting the server
- Update this handoff with the chosen DB source and the cache file location

### Phase 4 — Nice-to-haves
- [ ] Favorites / ratings
- [ ] Tempo / pitch shift
- [ ] Multi-client coordination (audience requests show up for the DJ to approve)

---

## Decisions made (no need to revisit)

| Question | Answer | Why |
|---|---|---|
| Use Jellyfin? | **No** | Can't render CDG |
| Local server vs single-file HTML? | **Local server** | Phones need to reach the library over Wi-Fi |
| Frontend framework? | **None for v0** | Faster to ship; add later if needed |
| Database? | **None for v0** | In-memory index is fine for browse/search |
| MVP scope? | **Browse + preview only** | Queue/playlist explicitly deferred |
| Build order? | **v0 → cleanup → DJ tools** | Player first, polish later |

---

## Operating environment

- **OS:** Windows
- **Browser:** Firefox
- **Editor:** None set up yet (suggest VS Code when needed)
- **Git:** Installed (`2.54.0.windows.1`)
- **Node:** **Not yet installed** ← current blocker
- **Powershell:** Available
- **Bash:** Git Bash available

---

## ADHD-friendly working agreement

From CLAUDE.md, restated for any agent continuing this work:

- Interest-driven; needs a clear, small first step, not a staircase
- Iteration is the method — ship v0 fast, then refine
- Don't dump multi-part instructions; chunk with stopping points
- Make reasonable decisions and move forward; don't ask between five options when two will do
- Explain the "why" briefly, not at length

---

## Current state (as of 2026-05-15, end of session)

**v0 + v1 are SHIPPED.** Phase 0 + Phase 1 + Phase 2 are complete.

**Done:**
- Inventory complete (62,142 paired songs, 338 GB, full report saved)
- Architecture chosen + implemented (Node + Express + plain HTML, no framework)
- Node.js v24 installed on laptop
- `karaoke-app/` project scaffolded at `C:\Users\crazy\Desktop\Executive Assistant\karaoke-app\`
- Library scanner with on-disk cache (62,142 pairs indexed)
- Search API (case-insensitive, matches against artist/title/filename/disc code)
- File streaming with HTTP byte-range support (audio seeking works)
- Synced CDG+MP3 player in the browser
- Verified working with songs from 3+ different karaoke vendors
- README inside the project for "start before a gig"

**Verified working (v0):**
- Browse + search the full 62k library
- Click any song, audio plays, lyrics render synced
- Esc closes the player cleanly
- Audio scrubbing keeps lyrics in sync
- **Phone access over Wi-Fi:** verified from a phone on The Pointe Wi-Fi. The Pointe uses CGNAT (`100.64.x.x` per device) but does not isolate intra-unit traffic. Windows Firewall auto-allowed Node on the Private network profile. Gotcha: Firefox mobile defaults to HTTPS-Only Mode and silently upgrades `http://` to `https://`, which fails against our plain-HTTP server. Either disable HTTPS-Only Mode on the phone or click "Advanced → Continue to site" on the warning.

**Visual design (v3, in progress):**
- "Shooter's List" wordmark in Permanent Marker (Sharpie) font
- Photo collage backdrop: Brew 5 neon as full-bleed background, Brew 1/4/6 tilted at corners
- Spray-paint accents, marker-style buttons, taped-paper queue panel
- Three rounds done; user feedback: "closer but still not my aesthetic"
- **Removed `backdrop-filter: blur()` everywhere — perf killer on hover.** Translucent surfaces now use solid rgba.
- **Next:** see `karaoke_claude_design_brief.md` — a self-contained prompt to paste into Claude (with the 6 photos attached) for a sharper design direction. Open to a real visual shift, not incremental tweaks.

**Library expanded:**
- 3,473 of 3,477 zip files extracted (4 corrupted, logged)
- Library went from 62,142 → **65,672 paired songs**
- Extraction script lives at `karaoke-app/scripts/extract-zips.js` — safe to re-run

**Phase 3a shipped (smart parser, no external deps):**
- New `parseFilename()` in `server/library.js` handles 3 patterns:
  1. Disc code at the END (`Adele - Hello - 50052`)
  2. Disc code at the START with greedy split (preserves "Ne-Yo", "K-Ci & JoJo")
  3. Non-greedy fallback for tight-dash filenames
- Prefix-based field-order table: `A`, `AD`, `DKM`, `EK`, `G`, `M`, `TU`, `ZMP` use Title-Artist order (auto-swapped). Add more prefixes to the set as discovered.
- "Last, First" names normalized to "First Last"
- **Result: 89.9% (59,035 of 65,672) songs have clean parsed artist + disc code.** Remaining 10.1% are oddballs (no disc code, underscore-separated names, malformed) — still searchable via filename match.

**Phase 3a v2 (additional polish):**
- `parseFilename` extended with a 4th pass: handles "Artist - Title" filenames that have no disc code at all (Beatles, Madonna, Queen, Presley, etc.).
- **Final parse rate: 98.7%** (64,797 of 65,672 songs have artist + parsed structure). Remaining 1.3% (875 songs) are oddball formats (e.g. `SC 8385-15` with stray space, `track07`, numeric-only codes). Inventory of unparsed clusters exported to `karaoke-app/unparsed-songs.txt` for review.

**DJ workflow polish:**
- "Up next" hint renamed to "On Deck" inside the player overlay.
- "DJ" badge moved to the left of "Shooter's List" wordmark.
- **Singer-name tracking**: optional text input on the DJ page; whatever's in it attaches to the next "+ Queue" click. Persists across reloads (localStorage). Displayed in amber marker font next to the song. Empty = anonymous. Audience never sees this input or any name data.

**Remote sharing — Cloudflare Tunnel + Basic Auth:**
- `cloudflared` installed on the dev PC (`C:\Program Files (x86)\cloudflared\`, added to user PATH).
- Server now supports HTTP Basic Auth on the DJ surfaces (`/dj`, `/api/queue*`, `/api/events`) via `DJ_USER` and `DJ_PASS` env vars. If `DJ_PASS` is unset, auth is disabled (local-dev default; server logs a warning).
- Audience pages remain unauthenticated by design (Shooter wants the audience flow to be a frictionless catalog).
- Workflow for sharing: start server with `DJ_USER=shooter DJ_PASS=... npm start`, run `cloudflared tunnel --url http://localhost:3000` in another terminal, send the `trycloudflare.com` URL + creds in separate messages.
- Full instructions in `karaoke-app/README.md` under "Sharing a remote preview".
- Ephemeral mode chosen (no Cloudflare account needed). URL changes on every tunnel restart.

**Phase 3b (not yet started — future work):**
- AcoustID / Chromaprint audio fingerprinting for gold-standard accuracy on the remaining 10.1% and validation of the other 89.9%
- Requires `fpcalc` binary install + free AcoustID API key
- Slow (~3-5s per song = ~50 hours for full library batch)
- Could be run once, results cached forever

**Project location (as of 2026-05-16):**
- The app folder is at `C:\Users\crazy\Desktop\Executive Assistant\Karaoke Project\karaoke-app\` (was previously at `Executive Assistant\karaoke-app\` directly — wrapped in a `Karaoke Project\` parent folder).
- All commands in the README assume this path.

**Operational artifacts now in the project:**
- `karaoke-app/scripts/extract-zips.js` — zip extractor, safe to re-run
- `karaoke-app/extract-zips.log` — log from the May 15 extraction run
- `karaoke-app/unparsed-songs.txt` — 875 filenames that the Phase 3a parser still can't split; grouped by leading-letter prefix
- `karaoke-app/library-cache.json` — auto-generated; delete or set `FORCE_RESCAN=1` to rebuild
- `karaoke-app/README.md` — operational instructions including the Cloudflare Tunnel + auth flow
- `karaoke_claude_design_brief.md` — design pass brief for next aesthetic iteration
- `karaoke_shooter_sunday.md` — questions to ask Shooter in person

**Verified working (v1):**
- Two roles: audience at `/`, DJ at `/dj`. Audience has zero queue/now-playing UI by design (per Shooter's preference for pen-and-paper requests).
- DJ can `+ Queue` any song, see live count, drag-to-reorder (≡ handle), play (▶), remove (×), or `Clear all`.
- Manual advance: the `⏭ Skip` button inside the player overlay jumps to the next queued song. Songs do **not** auto-advance on end — Shooter wants to talk between songs and click into each one (decided 2026-05-29). To re-enable auto-advance, re-add the `'ended'` listener in `public/app.js` (commented marker is there).
- `Up next:` hint inside the player shows what's coming.
- Real-time sync via Server-Sent Events — changes appear instantly on every open DJ tab/device, no polling.
- Audience preview: 30-second soft cap. At 30s the audio **pauses** and the hint swaps to *"Preview ended (30s sample). Press Esc to close."* — leaves the last lyric frame on screen instead of yanking the player closed (which felt jarring). User closes with Esc or the close button when ready.

**Known issues (not blockers, tracked for later phases):**
- Artist/title parsing is regex-based, fails on ~30-40% of names — phase 3 fix
- 3,477 zip packs on the drive are unextracted
- 52 CDG orphans (matched MP3 missing) and 6 MP4 video karaoke files unaddressed
- Queue state is lost on server restart (in-memory) — fine for a 4-hour gig
- No play history yet
- `/dj` is unguarded by default locally (security through obscurity); gated by Basic Auth when `DJ_USER`/`DJ_PASS` are set — required before exposing via Cloudflare Tunnel
- Firefox 404s a `favicon.ico` request — purely cosmetic
- **Audience preview cap is leaky.** The 30s pause uses a one-shot `previewCapped` flag and only checks on `timeupdate`. Scrubbing past 30s or hitting play again after the pause both bypass the cap — audio plays unbounded. Fix is small: drop the one-shot flag (always pause when `currentTime >= 30`), and also pause on `seeking` if the seek target is past the cap. Noted 2026-05-29; not urgent for prototype sharing but should be tightened before any real public exposure.

---

## Shooter's answers (Sunday convo, captured 2026-05-29)

All 8 questions from the now-archived `karaoke_shooter_sunday.md` got walked through. Decisions:

| # | Question | Shooter's answer |
|---|---|---|
| 1 | Phone-submitted requests? | **No, not in plan.** Stays pen-and-paper. Endpoint exists if it ever flips. |
| 2 | Track who's singing? | **DJ-side input is right** (already shipped). No audience-facing name capture. |
| 3 | "Now playing" display anywhere? | **DJ laptop only for now.** No `/display` screen, no audience-side now-playing. |
| 4 | Audience-page extras? | **Eventually a QR code** next to him for joining the audience page. Parked. No tip jar / branding. |
| 5 | Auto-advance vs manual? | **Manual.** He wants to talk between songs and click into each one himself. **⚠️ This is a behavior change — we shipped auto-advance ON. Needs to flip off (or become a toggle).** |
| 6 | Filter adult / parody packs? | **No. Leave everything visible.** Full catalog stays exposed in audience search. |
| 7 | Import existing setlists? | **No.** Building each night on the fly, against this database. |
| 8 | Network setup at gigs? | **Home Wi-Fi, prototype phase.** Laptop's not at live gigs yet — current PC is the prototype rig. Gig-network checklist not urgent. |

### Resulting action items

- [x] **Flip auto-advance off** (Q5) — done 2026-05-29. Removed the `'ended'` listener in `public/app.js`; updated hint text in `public/dj.html`. Skip button is now the only way to advance. Marker comment left in the JS for easy re-enable.
- [x] **Soften the audience 30s cutoff** — done 2026-05-29. Replaced the hard `closePlayer()` with `$audio.pause()` + a hint-text swap. New `id="preview-hint"` on the audience hint paragraph; `resetPreviewHint()` runs in `openPlayer()` so each new song re-arms the cap.
- [ ] **Tighten the audience preview cap** — known leak (see "Known issues"). Scrubbing past 30s or replaying after the pause bypasses the cap. Small fix, future session.
- [x] **Tier 1 Cloudflare tunnel verified** — `cloudflared tunnel --url http://localhost:3000` issues an ephemeral `*.trycloudflare.com` URL. DJ side gated by `DJ_USER`/`DJ_PASS` env vars (returns 401 without). Audience side open. URL dies on tunnel restart. Tier 2 (named tunnel via free Cloudflare account) is the next step if/when a stable URL becomes worth the 10-min setup.
- [ ] **QR-code-to-audience-page** (Q4) — parked, no due date. Trivial when ready: generate a QR pointing to the audience URL, render on a `/qr` page or printable card.
- [x] With auto-advance flipped, the rest of v1 matches Shooter's mental model.

---

**Next session can pick any of:**
- **Tighten the audience preview cap** — known leak documented above. Small, contained, would close out the "ready to share more broadly" gap.
- **Design pass** — `karaoke_claude_design_brief.md` is still the open aesthetic question. Visual shift needed; v3 stalled.
- **Tier 2 Cloudflare upgrade** — named tunnel + persistent URL. ~10 min one-time setup, free, removes the "URL changes every restart" friction.
- **Phase 3: library cleanup** — disc-code lookup pipeline, fingerprinting for the stubborn 1.3%.
- **Polish items** — favicon, queue persistence, play history.
- **Stop and let it bake** — v1 is now real enough to share with one or two trusted people via the ephemeral tunnel. Use it, find what's broken in practice, *then* decide what to build.
