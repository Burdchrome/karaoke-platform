# Karaoke Server (v1)

Local karaoke platform for Shooter's DJ gigs. Serves CDG+MP3 pairs from
`E:\karaoke` to any browser on the local Wi-Fi.

**Library:** 43,335 unique songs (from 65,832 files on disk — duplicate
artist+title copies are collapsed at load; each song carries a `versions`
count). All zips extracted except 4 corrupt ones — see `extract-zips.log`.
**Two roles:** audience at `/`, DJ at `/dj`.

---

## Quick start (before a gig)

1. **Plug in the 2TB external drive** (must show up as `E:` in File Explorer).
2. **Open a terminal** in this folder.
3. Run:
   ```
   npm start
   ```
4. Wait for the line `Karaoke server listening on http://localhost:3000`.
   - First time after a library change: scans the drive (~1–2 minutes).
   - Subsequent starts: instant (uses `library-cache.json`).
5. **On the laptop:** open Firefox → http://localhost:3000
6. **On a phone/tablet** (same Wi-Fi):
   - Find the laptop's IP: run `ipconfig` in PowerShell, look for "IPv4 Address" under your Wi-Fi adapter (something like `192.168.1.42`).
   - Open the phone's browser → `http://192.168.1.42:3000`
   - If it doesn't load, see "Firewall" below.

To stop: press `Ctrl+C` in the terminal.

---

## What works (v1)

**Audience (`/`):**
- Search 62k songs by artist, title, or disc code
- Preview any song on their own device (audio + synced lyrics)
- Esc closes the preview
- Deliberately minimal — no queue, no requests, no "now playing" UI

**DJ (`/dj`):**
- Everything the audience has, plus:
- `+ Queue` button on each search result
- Queue panel showing what's coming up, with live count
- Per-entry: drag-to-reorder (≡), play (▶), remove (×)
- `Clear all` button for the queue
- Manual `⏭ Skip` button — pops the head of the queue and plays it.
  (Auto-advance on song end is intentionally OFF — Shooter talks between
  songs and clicks into each one himself.)
- `Up next` indicator inside the player overlay
- Real-time sync between multiple DJ tabs/devices (Server-Sent Events)

## What doesn't work yet (deferred)

- **Metadata cleanup** — artist/title labels are sometimes swapped or blank.
  Search-by-filename catches these so songs are still findable. Phase 3 will
  replace the regex with a disc-code-lookup pipeline.
- **Version picker** — dedupe keeps an arbitrary copy of each song; if a
  specific disc's arrangement is ever wanted, expose the `versions` list.
- **4 corrupt zips** failed extraction (truncated downloads) — re-source or ignore.
- **52 CDG orphans** (matched MP3 missing) — recoverable later.
- **Queue persistence** — state is lost on server restart. Fine for a 4-hour
  gig; SQLite/JSON-on-disk if needed later.
- **Play history** — what's been played isn't recorded yet.
- **Separate display screen** — for showing lyrics on a TV while DJ manages the
  queue on the laptop.
- **Favicon** — Firefox auto-requests one, we 404.

See `karaoke_project_handoff.md` (in the parent folder) for the full roadmap.

---

## Sharing a remote preview (Cloudflare Tunnel)

When you want someone outside your local network (e.g. Shooter for a Sunday
demo) to hit the app, you can expose `localhost:3000` through a temporary
public HTTPS URL via **Cloudflare Tunnel**.

### One-time setup

Install `cloudflared` if you don't already have it:

```powershell
winget install --id Cloudflare.cloudflared
```

After install, the binary lands at `C:\Program Files (x86)\cloudflared\`.
This path is on the user PATH for new terminals — open a fresh Git Bash /
PowerShell after install.

Verify:
```
cloudflared --version
```

### Every time you want to share

**Step 0 — dependency audit** (per ADR 0005: the tunnel is the trust boundary):

```
npm audit
```

Fix anything moderate or worse (`npm audit fix`) before exposing the app.

**Terminal 1 — start the server with a DJ password:**

Git Bash:
```bash
cd "/c/Users/crazy/Desktop/Executive Assistant/Karaoke Project/karaoke-app"
DJ_USER=shooter DJ_PASS='pick-something-long-and-random' npm start
```

PowerShell:
```powershell
cd "C:\Users\crazy\Desktop\Executive Assistant\Karaoke Project\karaoke-app"
$env:DJ_USER='shooter'; $env:DJ_PASS='pick-something-long-and-random'; npm start
```

Look for `DJ auth: ENABLED` in the log line. If you forget to set `DJ_PASS`,
the server logs a warning and the DJ page is unprotected — fine for local
dev but **never tunnel without it set.**

**Terminal 2 — start the tunnel:**
```
cloudflared tunnel --url http://localhost:3000
```

Cloudflared prints a URL like:
```
https://computation-station-reads-release.trycloudflare.com
```

That's the public URL. Subdomain changes every run — ephemeral mode is
designed that way.

### Smoke test before sharing

In a **private/incognito browser window** (so saved credentials don't fool
you), open:

- `https://<your-url>.trycloudflare.com/` — audience page loads, no prompt
- `https://<your-url>.trycloudflare.com/dj` — browser prompts for username
  and password. Enter the creds you set. DJ page loads.

If both pass, you're ready to share.

### What to send

Two separate messages to your collaborator:

> Preview URL: `https://<your-url>.trycloudflare.com` — audience flow at /,
> DJ flow at /dj.

> DJ login: user `shooter`, pw `pick-something-long-and-random`

Don't put URL + creds in the same message.

### Stopping

- Tunnel terminal: `Ctrl+C` — URL dies instantly.
- Server terminal: `Ctrl+C` — server stops. Tunnel terminal will start
  reporting connection errors; you can leave it or kill it too.

### Notes

- **The tunnel URL changes every restart.** If you want a permanent URL
  (e.g. a stable `shooter-preview.example.com`), you need a Cloudflare
  account + a named tunnel + a domain on Cloudflare. Out of scope for the
  ephemeral workflow.
- **Audience side is intentionally not auth-gated.** Shooter can demo the
  audience flow to anyone without sharing creds. Lock it later if you ever
  want to.
- **Your laptop must stay awake** while the tunnel is up — sleep kills it.
- The server's `library-cache.json` and `server.log` are unaffected by any
  of this.

---

## HOWTO: add new songs

1. Copy the new CDG+MP3 pairs (or zips of them) anywhere under `E:\karaoke`.
2. If they arrived as zips, extract them in place:
   ```
   node scripts/extract-zips.js
   ```
   (Needs `unzip` on PATH — Git Bash has it. Safe to re-run; never overwrites.)
3. Force a library rescan:
   ```
   npm run rescan
   ```
   (Works in any shell. `FORCE_RESCAN=1 npm start` in Git Bash still works too,
   as does deleting `library-cache.json` and starting normally.)
4. Sanity check: the startup log prints the new song count, and
   `/api/health` reports it too.

### Fixing a wrongly-labeled song

Edit `overrides.json` (app root) — a map of file id (or exact filename,
without extension) to the corrected fields:

```json
{
  "DKM2014-02 - Wrong Artist - Wrong Title": { "artist": "Fleetwood Mac", "title": "Dreams" }
}
```

Overrides apply on every startup — no rescan needed — and survive rescans.
The startup log prints how many were applied.

---

## Firewall

If the phone can't reach the laptop, Windows Firewall is probably blocking Node.
The first time you run `npm start`, Windows usually pops up an "Allow access"
dialog — click Allow for **both Private and Public networks**.

If you dismissed that dialog, you can add the rule manually in an
**Administrator PowerShell**:

```
New-NetFirewallRule -DisplayName "Karaoke" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

---

## Project layout

```
karaoke-app/
├── server/
│   ├── index.js          # Express app entrypoint, mounts routes
│   ├── library.js        # scans E:\karaoke, builds song index (cached to disk)
│   ├── queue.js          # in-memory queue state + EventEmitter
│   ├── logger.js         # winston structured logging
│   └── routes/
│       ├── songs.js      # GET /api/songs?search=...
│       ├── stream.js     # GET /api/stream/:id/(mp3|cdg) with byte-range
│       ├── queue.js      # GET/POST/DELETE /api/queue + POST /api/queue/move
│       └── events.js     # GET /api/events — SSE for live queue updates
├── public/
│   ├── index.html        # AUDIENCE: search + preview, no queue
│   ├── dj.html           # DJ: same plus queue management
│   ├── app.js            # one script for both pages, DOM-detects role
│   └── styles.css        # shared styles
├── scripts/
│   └── extract-zips.js   # one-off: extract karaoke pack zips in place
├── library-cache.json    # auto-generated; delete to force rescan
├── server.log            # auto-generated; structured JSON logs
├── TEST_LOG.md           # manual test sessions (what changed, what was verified)
└── README.md             # this file
```

## Documentation map

System-level docs live here; everything project-level (product, design,
architecture diagram, ADRs, specs, roadmap) is mapped in the repo root
**`../README.md`** — that's the entry point for anyone new.

1. **This README** — what it is, how to run it, HOWTOs, API.
2. **`TEST_LOG.md`** — what's been manually verified, session by session.

Rule of thumb: the README documents the *system*, the handoff documents the
*project*. If a fact is about how the app works today, it belongs here; if
it's about where the work is going, it belongs in the handoff.

## API summary

```
GET    /api/health                       # liveness + uptime + song count
GET    /api/songs?search=...&limit=N     # search/list songs
GET    /api/stream/:id/mp3               # stream audio (byte-range)
GET    /api/stream/:id/cdg               # stream CDG bytes

GET    /api/queue                        # current queue + enriched metadata
POST   /api/queue        {songId, requestedBy?}   # append to queue
DELETE /api/queue                        # clear the whole queue
DELETE /api/queue/:entryId               # remove one entry
POST   /api/queue/move   {entryId, newPosition}   # atomic single-move

GET    /api/events                       # Server-Sent Events stream
```

---

## Logs

- **Console output** while the server is running: human-readable
- **`server.log`** in this folder: full JSON, one event per line. Useful for
  debugging after a gig. Open it in any text editor.
