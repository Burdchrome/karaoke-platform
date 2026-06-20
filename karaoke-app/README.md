# Karaoke Server (v1)

Local karaoke platform for Shooter's DJ gigs. Serves CDG+MP3 pairs from
`E:\karaoke` to any browser on the local Wi-Fi.

**Library:** 65,672 paired songs as of last scan (3,473 zips extracted 2026-05-15).
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
- Auto-advance when a song ends → next queued song plays automatically
- Manual `⏭ Skip` button mid-playback
- `Up next` indicator inside the player overlay
- Real-time sync between multiple DJ tabs/devices (Server-Sent Events)

## What doesn't work yet (deferred)

- **Metadata cleanup** — artist/title labels are sometimes swapped or blank.
  Search-by-filename catches these so songs are still findable. Phase 3 will
  replace the regex with a disc-code-lookup pipeline.
- **3,477 zipped karaoke packs** on the drive are not extracted yet.
- **52 CDG orphans** (matched MP3 missing) — recoverable later.
- **Queue persistence** — state is lost on server restart. Fine for a 4-hour
  gig; SQLite/JSON-on-disk if needed later.
- **Play history** — what's been played isn't recorded yet.
- **DJ vs audience auth** — `/dj` is unguarded (security through obscurity).
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

## Force a library rescan

If you add/remove files on the drive:

```
FORCE_RESCAN=1 npm start          # Git Bash
$env:FORCE_RESCAN=1; npm start    # PowerShell
```

Or delete `library-cache.json` and start normally.

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
├── library-cache.json    # auto-generated; delete to force rescan
├── server.log            # auto-generated; structured JSON logs
└── README.md             # this file
```

## API summary

```
GET    /api/health                       # liveness + uptime + song count
GET    /api/songs?search=...&limit=N     # search/list songs
GET    /api/stream/:id/mp3               # stream audio (byte-range)
GET    /api/stream/:id/cdg               # stream CDG bytes

GET    /api/queue                        # current queue + enriched metadata
POST   /api/queue        {songId}        # append to queue
DELETE /api/queue/:entryId               # remove one entry
POST   /api/queue/move   {entryId, newPosition}   # atomic single-move

GET    /api/events                       # Server-Sent Events stream
```

---

## Logs

- **Console output** while the server is running: human-readable
- **`server.log`** in this folder: full JSON, one event per line. Useful for
  debugging after a gig. Open it in any text editor.
