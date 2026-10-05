# Karaoke DJ Project — Master Handoff

**Last updated:** 2026-10-05 (repo PUBLIC since 2026-10-05 — `fix/25-sunfly-dialect-parse` fast-forwarded into main ahead of the Residual Run rulings as part of the flip; feedback review of the 09-27 gig still pending; Residual Run 25 still waits on Josh's rulings — TEST_LOG 2026-09-25b)
**Supersedes:** `karaoke_dj_handoff.md` (older — pre-inventory, contained open questions now answered)
**For:** Shooter, a karaoke DJ the user knows personally

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
| **Paired songs (CDG + MP3, both present, matching names)** | **65,832** (verified rescan 2026-07-09; 43,335 unique after dedupe) | ~330 GB |
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

- **Node + Express:** small, easy to read, huge ecosystem, errors are obvious
- **No frontend framework (yet):** plain HTML/JS for v0 — fewer moving parts, faster first run. Add React only when it's actually needed
- **No database (yet):** library is scanned into memory at startup; SQLite added later if queue/history needs persistence
- **Winston logger:** structured logs so debugging during a gig is possible
- **Jest for tests:** added once there's logic worth testing (queue management, search relevance)

---

## Phases

**✅ Phases 0–2 shipped** — see [Current State](#current-state-as-of-2026-05-15-end-of-session) below for full detail.

### Phase 3 — Library cleanup
- [x] Extract the 3,477 zip files — extraction ran 2026-05-15 (`extract-zips.log`); verification + rescan is map ticket #2
- [ ] Try to match the 52 CDG orphans to MP3s elsewhere on the drive *(ruled out of the pipeline map's scope — own small effort later)*
- [ ] Decide what to do with the 6 MP4 video karaoke files *(same — out of map scope)*
- [ ] **Metadata cleanup pipeline** — **spec locked 2026-07-09**, ready to build:
  [docs/specs/metadata-pipeline-spec.md](docs/specs/metadata-pipeline-spec.md).
  Wayfinder map [issue #1](https://github.com/Burdchrome/karaoke-platform/issues/1)
  complete (tickets #2–#6 closed; decision log in the issue). Key outcomes:
  library verified at 65,832 songs; DB-lookup stage dropped
  ([research](docs/research/disc-code-lookup-sources.md)); parser plan = comma-shape
  inversion fix + 2 passes, songKey + versionLabel, cache v2, overrides.json.
  Manual rescue: [issue #8](https://github.com/Burdchrome/karaoke-platform/issues/8),
  un-held 2026-07-16 (batching is safe: overrides key on filename, so
  second-drive additions just form a new batch later). **Rescue round
  2026-07-16/17 (commit bf3d65b):** freedb dump grepped, every candidate
  cross-checked against library siblings (caught one off-by-one, freedb went
  1-for-3 on ear-checked guesses), 3 more confirmed by ear on CDG title
  cards → **overrides.json 4 → 17 entries, all library-backed**. ~41 code-only
  files remain for listening — unless
  [issue #21](https://github.com/Burdchrome/karaoke-platform/issues/21)
  (CDG title-card verification pipeline, plan at
  `docs/cdg-verification-plan.md`) lands first and reads them mechanically.
  Method + full results: `docs/research/freedb-rescue-results-2026-07-16.md`.
  Song identity: [ADR 0001](docs/adr/0001-song-identity-per-file-ids-plus-grouping-key.md).
  Venue preferences (Shooter: no key changes / no version-shopping) land as
  config flags, never a fork: [ADR 0002](docs/adr/0002-venue-config-not-fork.md)
  ([PR #17](https://github.com/Burdchrome/karaoke-platform/pull/17)) —
  `enableKeyChange` is the first flag when settings get built.
  **Spec ticketed 2026-07-10** as issues #9–#15 (native blocking; chain in
  workspace-state). **#9 done same day:** measurement script landed at
  `karaoke-app/scripts/measure-parse-coverage.js` (+ node:test tests;
  `npm test` / `npm run measure`). **Canonical baseline = the script's header:
  98.7% artist-present / 875 hard failures / 512 suspected inversions** —
  later tickets prove against these numbers, not the ticket-#3 comment.
  **#10 done 2026-07-10** (comma-shape fix, 16f855f): inversions **512 → 34**;
  heuristic scoped to title-first packs — running it globally inverts ~1,100
  clean-pack comma-shaped titles ("Walk, The"); residual 34 = both-shaped
  ties → #13/#8. Prefix-table/name-shape consolidation into `library.js` done.
  **#11 done same day** (stray-space + underscore passes, ebad900): hard
  failures **875 → 772** (−103); 4-rule code-rejoin pre-pass (naive underscore
  translation broke 45 garbage-parse files — rejoin parses them correctly);
  code-only codes still fail cleanly → #8. New dirt found: sc_8537 disc is
  title-first inside the SC pack — overrides.json candidate (#13).
  Parser unit tests: `karaoke-app/server/library.test.js`.
  **#12 done 2026-07-10** (songKey + versionLabel + cache v2, ed7eac1): every
  cache entry carries `songKey` (normalize both fields, pipe-joined) and
  `versionLabel` (trailing parens on the title); cache is `"version": 2` and
  a v1/unversioned cache auto-triggers a rescan, so parser upgrades
  self-apply. Real rescan: 65,832 songs, 39,313 unique songKeys, nine
  distinct "Dreams" stayed separate. `npm run rescan` added (uses a
  `--rescan` flag — cmd.exe can't do the `VAR=1` prefix). Spec §2 got an
  errata: its literal normalize order can't execute; working order noted.
  **#13 done same day** (overrides.json, 4439bc1 + 9c7bd51): file id (or
  filename) → `{artist, title}`, applied in memory on both load paths —
  cache stays raw parse, so edits take effect on restart without a rescan
  and rescans can't wipe corrections. Malformed files *and* half-written
  entries warn and skip, never crash. Ships `{}`; issue #8 populates it.
  **#14 done 2026-07-10** (serve-time grouping → songKey, a66be34 + 23f982c):
  version counting in `server/index.js` consumes `songKey` instead of its own
  ad-hoc grouping.
  **#15 ACCEPTANCE PASSED 2026-07-13 — PIPELINE DONE.** Fresh rescan
  (65,832 songs, cache v2) + `npm run measure` + spot checks; full results in
  [issue #15](https://github.com/Burdchrome/karaoke-platform/issues/15).
  **New canonical baseline: 98.8% artist-present / 772 hard failures /
  34 flagged inversions (all 34 verified correct parses — real inversions ≈ 0).**
  songKey sanity held (39,313 keys; nine "Dreams" separate; multi-disc copies
  group). 40-song spot-check: 37 clean, 1 known failure bucket, 2 known-class
  residuals for overrides.json (`PHM0204-08` title-first outside the prefix
  table, ≤25 PHM candidates; `TU067-16` artist-first in mixed-order TU pack).
  **Post-acceptance round 2026-07-15 (issues #18–#20, commits 8cd2c4d /
  0b17646 / f28c39d):** mobile review surfaced junk at the top of the list.
  Fixed: AppleDouble `._` sidecars skipped at scan (65,832 → 65,818 songs);
  overrides.json now carries its **first 6 real entries** (incl. both #15
  spot-check residuals); and a trackNN parser round fixed ~640 files across
  4 shapes — track tokens folded into disc codes, space-glued codes rejoined,
  bare 00–19 tracks stripped with **artist order resolved by a library-
  frequency check in `buildIndex`** (beets-style; flips only when the title
  side is a known artist ≥3× and the artist side never is). CACHE_VERSION
  2 → 3. **Current numbers: 839 hard failures (768 + 71 junk-artist parses
  now failing honestly), 34 flagged inversions (unchanged), 39,135 unique
  songKeys.** Details: TEST_LOG 2026-07-15 + issue #20.
  Watch item: `library.js` now ~530 lines — split the overrides
  functions into their own module next time we're in there.
  The sketch below is kept only as the original problem statement.
- [ ] Dedupe songs that exist under multiple disc codes (rolled into the metadata pipeline; fingerprinting deferred per the map)

#### Phase 3 spec — metadata cleanup pipeline (original sketch — superseded by map #1)

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
- **Editor:** VS Code installed (Josh works through Claude, not the editor)
- **Git:** Installed (`2.54.0.windows.1`)
- **Node:** v24 installed, npm available
- **Powershell:** Available
- **Bash:** Git Bash available

---

## Working agreement

Restated for any agent continuing this work:

- Interest-driven; needs a clear, small first step, not a staircase
- Iteration is the method — ship v0 fast, then refine
- Don't dump multi-part instructions; chunk with stopping points
- Make reasonable decisions and move forward; don't ask between five options when two will do
- Explain the "why" briefly, not at length

---

## Current state (running log — newest work is in "Next session can pick any of" below and TEST_LOG.md)

**Sensitive-text scrub (2026-10-05):** after the flip, a surname and four
ADHD mentions were removed from the handoff + design brief and rewritten
out of git history (`git filter-repo --replace-text`, list in workspace
`.scratch/public-scrub/`), force-pushed, and the three merged PR branches
deleted. Verified anonymously: 0 hits on main, old initial-commit URL
404. Ruled: TEST_LOG stays in the public repo. On hold: the first-name
sweep and the neutral actor word for recorded rulings. Enforcement point
(sensitive-word grep before push) not built yet.

**Repo went public (2026-10-04 → 05):** Josh wants a professional public
portfolio. Pass: gitleaks over all 80 commits (clean), MIT `LICENSE`, root
README gained a stack line + "How it was built" + license section, the
vendored impeccable skill untracked (tracked files ~180 → 80), repo
description + 6 topics set, then visibility flipped and confirmed with an
anonymous fetch. **Side effect:** `fix/25-sunfly-dialect-parse` (parser fix
+ make-qr + doc close-outs) was fast-forwarded into main *before* the
Residual Run 25 rulings — Josh's ruling 10-04 ("merge first"); suite was
143/144 green at merge. #25 stays open: the remaining work (rulings →
overrides → rescan) now happens on main. Ruling kept as-is: the DJ's
stage name stays in the repo "for now". Still owed by Josh: a screenshot
for the README, profile name/bio, pin the repo. Verification: TEST_LOG
2026-10-04.

**#21 Stage 1 harvest landed (2026-08-26):** the overnight CDG batch read
(launched 2026-07-18, silently stopped ~485/554) was finished — 554/554
files, 542 title cards read. New `scripts/cdg-harvest.js` matches card
reads against the named library and stages tiered override proposals;
Josh ratified the auto tier → **290 overrides applied, hard failures
839 → 419** (unique failing filenames 554 → 251), overrides.json at 307
entries. Remaining tiers (likely 70 / review 84 / unmatched 97) staged in
`karaoke-app/.cache/stage1-proposals.json` for a browse-and-rule session;
promote via `node scripts/cdg-harvest.js --apply <tiers>`. Verification:
TEST_LOG session 2026-08-26 (verified-in-test: server-path load counted
post-override failures; not yet walked in the live app). Trail: issue #21
receipt, commit `949290a` — pushed.

**Repo orientation (2026-08-18):** the repo now has a root `README.md` as
its single entry point — doc map with reading order, folder layout, Mermaid
flow diagram, and `karaoke-architecture.svg` exported from the `.drawio`
(re-export command noted in the README). `karaoke-app/README.md`'s doc map
was trimmed to system-level docs only; the repo-wide map lives in the root
README, nowhere else. `karaoke_claude_design_brief.md` is formally flagged
Historical in that map. Commits `2f9d8e9` + `ffc0aa0` pushed (confirmed
2026-08-26); Mermaid renders on GitHub, so the friend test can re-run.
Implements `code-standards.md` → Repo Orientation.

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

**Visual design (v4 "the scratched wall", shipped 2026-07-14, APPROVED by Josh 2026-07-15 on mobile):**
- Direction shift from v3's warm-cream cast: the real graffiti walls (Brew 4/6) are silver scratch-marker on neutral black, so ink went chalk-silver, background neutral black, red neon = the only glow. Amber demoted to DJ-only (Coors-script yellow: role pill, singer input, skip, drag states); cream reserved for paper objects (request slip, tape). Wordmark gained a `'26` year tag; texture is scratched lines, not spray grain.
- Tokens + full system documented in `DESIGN.md` (root); brand/product context in `PRODUCT.md`. `karaoke_claude_design_brief.md` is the historical v3-era brief (predates the "Karaoke List" rename — kept for reference).
- **No `backdrop-filter` anywhere** (perf) — translucent surfaces are solid rgba.
- All selectors preserved; verified structurally (TEST_LOG 2026-07-14), then visually by Josh on his phone via tunnel 2026-07-15 ("the look is great"). His two nitpicks became issues #18/#19, fixed same day.

**Library expanded:**
- 3,473 of 3,477 zip files extracted (4 corrupted, logged)
- Library went from 62,142 → **65,832 paired songs** (+3,690 from the zips;
  verified 2026-07-09 — extraction re-run clean, fresh `FORCE_RESCAN` rebuild
  matches. Earlier 65,672 figure was a stale mid-session number. Parse-rate
  stats below were measured against 65,672 and left as-is.)
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
- Workflow for sharing (since 2026-07-12): double-click `karaoke-app/start-sharing.cmd` — starts the server (auth on) and the tunnel in their own windows, prints the `trycloudflare.com` URL + DJ login when ready. `stop-sharing.cmd` tears both down. Runs standalone — survives any Claude session. Send URL + creds in separate messages.
- `karaoke-app/make-qr.cmd` (2026-09-27): reads the URL from `tunnel.log`, writes `tunnel-qr.png`, opens it — the audience joins by scanning the laptop screen. Re-run after any tunnel restart. Needs the `qrcode` devDependency (`npm install` once).
- Full instructions in `karaoke-app/README.md` under "Sharing a remote preview" → "Fast path (gig night)".
- Ephemeral mode chosen (no Cloudflare account needed). URL changes on every tunnel restart.

**Phase 3b (not yet started — future work):**
- AcoustID / Chromaprint audio fingerprinting for gold-standard accuracy on the remaining 10.1% and validation of the other 89.9%
- Requires `fpcalc` binary install + free AcoustID API key
- Slow (~3-5s per song = ~50 hours for full library batch)
- Could be run once, results cached forever

**Project location (as of 2026-05-16):**
- The app folder is at `Karaoke Project\karaoke-app\` (was previously at
  `Executive Assistant\karaoke-app\` directly — wrapped in a `Karaoke Project\` parent folder).
- All commands in the README assume this path.

**Version control (as of 2026-06-23):**
- Git repo root is `Karaoke Project/` (the parent of `karaoke-app/`), not `karaoke-app/`.
  Both the app code *and* the root-level docs (this handoff, design brief, inventory,
  architecture diagram) are tracked in one repo.
- Remote: `github.com/Burdchrome/karaoke-platform` — **PUBLIC since 2026-10-05** (MIT `LICENSE`, topics set; full-history gitleaks scan clean, see TEST_LOG 2026-10-04). Default branch `main`.
- `.claude/skills/impeccable/` is **untracked + gitignored** since 10-04 (102 files live on disk only — a fresh clone has no copy; reinstall from the global skill if a session needs it there). Only `.claude/settings.local.json` is tracked.
  Mostly direct-to-main; occasional PRs for review-worthy changes (#16, #17 —
  both merged). Issues are the tracker (docs/agents config, PR #7).
- Conventions (2026-07-18): commits/PRs reference their issue number
  (`docs/agents/issue-tracker.md` "Commit and PR linking"); karaoke-only code
  rules in `docs/agents/standards.md` (CACHE_VERSION bump, measure baseline,
  overrides-not-special-cases, library.js freeze) — project file wins over
  workspace `code-standards.md` on conflict; /code-review reads both.

**Operational artifacts now in the project:**
- `karaoke-app/scripts/extract-zips.js` — zip extractor, safe to re-run
- `karaoke-app/extract-zips.log` — log from the May 15 extraction run
- `karaoke-app/unparsed-songs.txt` — 875 filenames the parser can't split, clustered by failure pattern (regenerated 2026-07-09, ticket #3)
- `karaoke-app/scripts/measure-parse-coverage.js` — parse-coverage instrument (ticket #9); `npm run measure`; canonical baseline in its header; tests via `npm test`
- `karaoke-app/library-cache.json` — auto-generated, schema v2 (songKey + versionLabel); rebuild with `npm run rescan`
- `karaoke-app/overrides.json` — manual metadata corrections (file id or filename → artist/title); applied at startup, no rescan needed; 427 entries as of 2026-09-24 (grown via #8 rescue + #21 harvest auto-tier + card-audit promotions + #30 triage ratification)
- `karaoke-app/scripts/cdg-snapshot.js` — renders CDG title-card frames to PNG (issue #21 camera); `--scan` change-detection mode is the default choice
- `karaoke-app/scripts/cdg-read.js` — reads those frames with local `qwen3-vl:8b` and scores them against a truth file (issue #21 reader + comparator); `--truth overrides.json` is the calibration mode; `--out` report is checkpointed after every file and resumable (rerun with the same `--out` to continue an interrupted batch). Needs Ollama up and the GPU free of llama-server
- `karaoke-app/scripts/triage-apply.js` — triage promotion gate + evidence views (#28/#29); `--apply` promotes named verdict buckets into overrides, `--sample` deals N random records with evidence, `--queue` lists the human queue with card-audit notes. Tests: `scripts/triage-apply.test.js` + `scripts/triage-apply.e2e.test.js`
- `karaoke-app/scripts/` rescue helpers (`extract-code-only.cjs`, `find-siblings.cjs`, `verify-overrides.cjs`) — re-run when the second drive lands to build the next rescue batch
- `karaoke-app/README.md` — operational instructions including the Cloudflare Tunnel + auth flow
- `karaoke_claude_design_brief.md` — design pass brief for next aesthetic iteration
- `karaoke_shooter_sunday.md` — questions to ask Shooter in person
- `karaoke-architecture.drawio` / `karaoke-architecture.png` (project root) — system
  architecture diagram (clients → access → server → drive), built 2026-06-23. Includes
  the API surface, the songId-vs-entryId model, and the GitHub repo block. Editable in
  draw.io desktop; re-export PNG via the CLI. The hand-off companion to this doc for the
  two-minute visual tour.

**Verified working (v1):**
- Two roles: audience at `/`, DJ at `/dj`. Audience has zero queue/now-playing UI by design (per Shooter's preference for pen-and-paper requests).
- DJ can `+ Queue` any song, see live count, drag-to-reorder (≡ handle), play (▶), remove (×), or `Clear all`.
- Manual advance: the `⏭ Skip` button inside the player overlay jumps to the next queued song. Songs do **not** auto-advance on end — Shooter wants to talk between songs and click into each one (decided 2026-05-29). To re-enable auto-advance, re-add the `'ended'` listener in `public/app.js` (commented marker is there).
- `Up next:` hint inside the player shows what's coming.
- Real-time sync via Server-Sent Events — changes appear instantly on every open DJ tab/device, no polling.
- Audience preview: 30-second soft cap. At 30s the audio **pauses** and the hint swaps to *"Preview ended (30s sample). Press Esc to close."* — leaves the last lyric frame on screen instead of yanking the player closed (which felt jarring). User closes with Esc or the close button when ready.

**Known issues (not blockers, tracked for later phases):**
- Blank-artist residue: 774 files in the v5 cache before overrides
  (2026-09-24 scan); 427 overrides now cover the #8 rescue + #21 harvest
  auto tier + #30 ratification. What's left to rule is the 130-card
  Residual Run 25 queue (see #25 under "Next session").
- 52 CDG orphans (matched MP3 missing) and 6 MP4 video karaoke files unaddressed
- Queue state is lost on server restart (in-memory) — fine for a 4-hour gig
- No play history yet
- `/dj` is unguarded by default locally (security through obscurity); gated by Basic Auth when `DJ_USER`/`DJ_PASS` are set — required before exposing via Cloudflare Tunnel
- Firefox 404s a `favicon.ico` request — purely cosmetic
- ~~Audience preview cap is leaky~~ — **fixed 2026-07-12.** Dropped the one-shot `previewCapped` flag; the cap re-fires on every `timeupdate` and `play`, and `seeking` past 30s clamps back to the boundary. Verified in-browser: scrub-past and replay-after-pause both re-pause at 30s. Still client-side only (DevTools can bypass) — acceptable per the original design note.

---

## Shooter's answers (Sunday convo, captured 2026-05-29)

All 8 questions from the now-archived `karaoke_shooter_sunday.md` got walked through. Decisions:

| # | Question | Shooter's answer |
|---|---|---|
| 1 | Phone-submitted requests? | **No, not in plan.** Stays pen-and-paper. Endpoint exists if it ever flips. |
| 2 | Track who's singing? | **DJ-side input is right** (already shipped). No audience-facing name capture. |
| 3 | "Now playing" display anywhere? | **DJ laptop only for now.** No `/display` screen, no audience-side now-playing. |
| 4 | Audience-page extras? | **QR code — done in its cheapest form 2026-09-27:** `make-qr.cmd` renders the tunnel URL to a PNG shown on the laptop screen. An in-app QR is still unbuilt. No tip jar / branding. |
| 5 | Auto-advance vs manual? | **Manual.** He wants to talk between songs and click into each one himself. **⚠️ This is a behavior change — we shipped auto-advance ON. Needs to flip off (or become a toggle).** |
| 6 | Filter adult / parody packs? | **No. Leave everything visible.** Full catalog stays exposed in audience search. |
| 7 | Import existing setlists? | **No.** Building each night on the fly, against this database. |
| 8 | Network setup at gigs? | **First public run 2026-09-27** went through the ephemeral Cloudflare tunnel + QR rather than venue Wi-Fi, so the "same Wi-Fi" model was never exercised in the room. Gig-network checklist still not urgent; the tunnel path is the proven one. |

### Resulting action items

- [x] **Flip auto-advance off** (Q5) — done 2026-05-29. Removed the `'ended'` listener in `public/app.js`; updated hint text in `public/dj.html`. Skip button is now the only way to advance. Marker comment left in the JS for easy re-enable.
- [x] **Soften the audience 30s cutoff** — done 2026-05-29. Replaced the hard `closePlayer()` with `$audio.pause()` + a hint-text swap. New `id="preview-hint"` on the audience hint paragraph; `resetPreviewHint()` runs in `openPlayer()` so each new song re-arms the cap.
- [x] **Tighten the audience preview cap** — done 2026-07-12. Flag removed; `play` + `seeking` handlers added in `public/app.js`. Both bypass paths verified closed in-browser.
- [x] **Tier 1 Cloudflare tunnel verified** — `cloudflared tunnel --url http://localhost:3000` issues an ephemeral `*.trycloudflare.com` URL. DJ side gated by `DJ_USER`/`DJ_PASS` env vars (returns 401 without). Audience side open. URL dies on tunnel restart. Tier 2 (named tunnel via free Cloudflare account) is the next step if/when a stable URL becomes worth the 10-min setup.
- [ ] **QR-code-to-audience-page** (Q4) — parked, no due date. Trivial when ready: generate a QR pointing to the audience URL, render on a `/qr` page or printable card.
- [x] With auto-advance flipped, the rest of v1 matches Shooter's mental model.

---

**Triage promotion gate + evidence views (2026-09-18, `explore/mb-verify`):**
`scripts/triage-apply.js` built via the implement pipeline (Codex →
Sonnet advisor → Opus /code-review, ×2 tickets). Three mutually exclusive
modes: `--apply <buckets>` promotes named verdict buckets into
`overrides.json` (mirrors `cdg-harvest --apply`); `--sample <bucket>
[--n N]` deals random records with evidence for ruling; `--queue` lists
the human queue (130 records: flagged + judge-flagged + receipt_failed +
demoted) with card-audit notes attached. 24 tests (12 unit + 12 e2e);
full suite 129 pass / 1 gated skip; `npm run check` clean. Commits
`7a22d70` (#28) and `d930109` (#29). Josh ruled both judgment forks
2026-09-24: `--mb-report`/`--judge-report` blessed as read-path seams;
`--sample` attaches card-audit notes to every dealt record (`a4dbb79`).
**#30 ratification run 2026-09-24:** 26 records (10 confirmed sampled +
corrected/resolved/judge buckets in full) reviewed on a claude.ai artifact
page with CDG title-card frames + audio clips, rulings read back from the
page's db — 26/26 pass, 113 promoted (`189d046`), spot-checked through
`loadLibrary()`. Blast radius measured: 177 files changed, all previously
blank-artist, groups 37,789 → 37,687 (orphans merging in). Branch merged
to main (#31); seam tests for overrides × grouping (`ddb5c0e`) now guard
the next batch. Research doc:
`docs/research/llm-assisted-stage1-triage.md`. Backlog: file at 315
lines → extract `triage-views.js` on next touch; U+2010 hyphens in
MB-sourced names (TEST_LOG 2026-09-24 follow-up); the 130 human-queue
records are the #25 tiers — ruled on the Residual Run 25 page (see #25).

**Next session can pick any of:**
- **#25 Sunfly dialect parse — WAITING ON JOSH (rebased 2026-09-25)**:
  parser LANDED 09-13 (`aebbf6d` on `fix/25-sunfly-dialect-parse`, now
  rebased onto post-#31 main, local-only, suite green). Tiers regenerated
  against the 427 overrides: likely 18 / review 18 / unmatched 88 — and
  those are the #30 human queue (124/130 overlap; 6 extras are card-audit
  overturns). **Review page:** Residual Run 25
  (`https://claude.ai/artifact/6rsDqTEP3oTSjvrpaoUzqK`), 130 cards,
  editable artist/title, Pass/Doubt → page db `rulings/{id}`
  ({verdict, artist, title, note, filename, bucket, tier, at}). Build
  kit + `manifest.json` (id → filename/paths) in
  `karaoke-app/.cache/residual-run-25/`. **Agent layers added 09-25:**
  prefill-order bug fixed (judge correction now outranks the MB
  title-lookup proposal — it had prefilled the famous performer instead
  of the file's own on 4 cards); every card carries an "agent says"
  verdict from a Sonnet text gate (102 pass / 28 doubt), and the 91
  Fill-in/doubt cards were re-read from the CDG frames by a vision gate
  ("agent (read frames)", doubts 28 → 16 on that set). Kits in
  `.cache/residual-run-25/gate/` and `vision/`; the vision PROMPT.md is
  the spec for fixing the stage-1 card reader (it grabs cue frames on
  Music Maestro/Zoom discs). **Remaining:** Josh rules (8/130 saved;
  "Traditional as artist?" policy call clears 9 at once) → read
  `rulings` back → passes into `overrides.json` (fields as edited) →
  rescan → close #25 + the queue item (branch already on main since 10-04). Numbers +
  eyeball list: TEST_LOG 2026-09-25b; parser receipt on issue #25.
- **Lens-pass leftovers (unratified, from the 08-31 ch.4 pass):** deepen
  `loadLibrary()` to return `{groups, byId}`; optional dep cuts
  (winston→console, nodemon→`node --watch`, double-walk→`fs.readdir
  recursive`).
- **Deferred-with-triggers:** feat-clause dedupe (~47 dupes, marker in
  makeSongKey); hyphen-variant artists; second-drive batch.
- **Public-repo leftovers (Josh's hand):** audience-view screenshot for
  the README (needs the drive), GitHub profile name/bio + pin, and a
  ruling on whether the DJ's surname in this handoff's "For:" line stays
  now that the file is public.
- **Feedback review of the 2026-09-27 public run** — first thing at pickup;
  then `npm audit fix` + suite (README step 0 was skipped that night).
- **Watch:** 3 list stragglers in #20's close comment; share-URL box by
  eye on next launch (TEST_LOG 2026-09-01 follow-up — URL path proven
  09-27, the printed box itself not confirmed).
- **Venue settings flag** — `enableKeyChange` (ADR 0002) next time the UI gets touched.
- **Tier 2 Cloudflare upgrade** — named tunnel + persistent URL. ~10 min one-time setup, free, removes the "URL changes every restart" friction.
- **Phase 3 metadata pipeline: DONE 2026-07-13** — all tickets #9–#15 closed-or-passed; acceptance numbers in the Phase 3 section are the new baseline. #21 (card harvest) and the #27–#31 triage arc are done too; the only open metadata thread is #25's 130-card human queue above. (Lookup pipeline and fingerprinting were both rejected by the map — don't resurrect them.)
- **Polish items** — favicon, queue persistence, play history.
- **Stop and let it bake** — v1 has now had one real public night (2026-09-27). Harvest what broke in practice at the feedback review, *then* decide what to build.
