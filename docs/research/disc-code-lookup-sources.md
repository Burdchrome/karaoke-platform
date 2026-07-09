# Disc-Code Lookup Sources — Research Findings

**Ticket:** #4 (wayfinder map, metadata pipeline) · **Date:** 2026-07-09
**Question:** Do any freely-available karaoke disc-code lookup sources cover the disc codes in our failure corpus (~875 unparseable files, subset disc-code-only)?

---

## Summary & Recommendation

**Recommendation: (b)-leaning — do NOT build an automated lookup stage.** Do a one-time,
semi-manual resolution pass instead, using two assets:

1. **The archived freedb database dump** (offline, free, greppable) — confirmed to contain at
   least one of our exact sample discs (Chartbuster `CBEP454`), with per-track listings that
   also answer the artist-first vs title-first ordering question for any disc it covers.
   Download: `freedb-complete-20200601.tar.bz2` via archive.org
   (https://archive.org/download/freedb, mirror index preserved at
   http://ftp.freedb.org/pub/freedb/). Data license is GPL (freedb was GPL-licensed CDDB data).
2. **Community songbook PDFs** — karaokeshack.com hosts free HTML disc-ID lists + a
   member-compiled PDF catalogue for the *complete* Sound Choice catalog
   (https://www.karaokeshack.com/sound-choice/), and karaoke.info hosts songbooks for Sound
   Choice, Chartbuster, DK, Zoom, and Top Tunes — including a **DAT (Disc, Artist, Title)**
   ordering that is exactly a disc-code→artist/title mapping
   (https://www.karaoke.info/sound-choice-songbook/). Caveats: karaoke.info downloads are
   membership-gated; karaokeshack was returning HTTP 522 (origin down) throughout testing and
   is only reachable via the Wayback Machine.

**Why not build machinery:** no source offers a search API or bulk open data keyed by disc
code. MusicBrainz — the only truly open, API-first candidate — returned **zero** results for
our sample codes. Everything else is PDFs, gated downloads, or scraping fragile hobbyist
WordPress sites. The affected population is a *subset* of 875 files out of 65,832 (<1.3%);
per the standing "measure before machinery" policy, the right move is: count the
disc-code-only files first, and if it's a few hundred, resolve them in one sitting with the
freedb dump grep + songbook PDFs, hand-entering the results. An automated stage would cost
more to build and maintain than the manual pass costs once.

---

## Sample-code test matrix

| Code | MusicBrainz API | gnudb/freedb | karaokeshack | karaoke.info | Web search |
|---|---|---|---|---|---|
| SC8385 (Sound Choice) | **MISS** (count:0, tested) | not tested (search UI PoW-gated) | listed in SC catalog pages¹ (not directly verified — site down) | in gated SC songbook (claimed full catalog) | no track list surfaced |
| SC7518 (Sound Choice) | **MISS** (count:0, tested) | not tested | same as above | same as above | not tested |
| CBEP454 (Chartbuster EP) | not tested | **HIT** — `CBEP454-04 / Chartbuster (CB)`, 17 tracks, gnudb entry https://gnudb.org/cd/mif40a9511 | n/a | gated CB songbook exists (https://www.karaoke.info/chartbuster-review/) | HIT via gnudb result |
| CBEP459 | not tested | not tested (same series as confirmed hit — plausible) | n/a | same | not tested |
| rb01403 (RockBox?) | not tested | not tested | **MISS** — no "RB"/Rock Box disc series found anywhere; "Rock Box" hits are a Seattle karaoke bar and unrelated software | no Rock Box label page found | **MISS** |
| DKK003 (DK Karaoke?) | not tested | not tested | DK series page exists (https://www.karaokeshack.com/dk-series/) but documented DK prefixes are DKG/DKP/DKA/DKE — **no DKK prefix found** | DK songbook exists (https://www.karaoke.info/dk-songbook/); free disc-list PDF confirmed downloadable (https://www.karaoke.info/wp-content/uploads/2014/08/dk-discs-01.pdf, HTTP 200, 45 KB)² | partial |
| ZOOM011 (Zoom UK) | not tested | not tested | Zoom page exists (https://www.karaokeshack.com/zoom/) — documented prefixes ZPCP001–036 etc.; literal "ZOOM011" **not found** | Zoom songbook page (https://www.karaoke.info/zoom-songbook/) | MISS as literal code |

¹ Wayback capture of karaokeshack's Sound Choice page confirms it enumerates the complete SC disc-ID catalog (SC0001 onward, four pages) with an accompanying member-built PDF song list ("we believe that we have all the complete catalogue"): https://web.archive.org/web/2024/https://www.karaokeshack.com/sound-choice/
² PDF text extraction failed locally (subset-encoded fonts); content not verified beyond existence. It appears to be a disc *list*, not necessarily per-track.

**Codes actually exercised against a live query: SC8385, SC7518 (MusicBrainz), CBEP454 (via gnudb search-index hit), ZOOM011, DKK003, rb01403 (web search only).** CBEP459 untested.

---

## Per-source detail

### 1. karaoke-version.com — NOT USEFUL
Modern à-la-carte download store selling its own re-recordings ("in the style of"); catalog
has no legacy disc-code concept at all. A targeted search for disc codes on the site returned
nothing (https://www.karaoke-version.com/karaoke/). No disc-code lookup possible. Skip.

### 2. MusicBrainz — TESTED, MISS
- `https://musicbrainz.org/ws/2/release?query=catno:SC8385&fmt=json` → `count: 0`
- `https://musicbrainz.org/ws/2/release?query="sound choice" AND catno:7518&fmt=json` → `count: 0`

Karaoke discs from these 1990s labels are essentially absent as releases. Licensing (for the
record): core data is CC0 / public domain, supplementary data CC BY-NC-SA
(https://musicbrainz.org/doc/About/Data_License) — great terms, but nothing to look up.
API is clean (1 req/s rate limit), which makes the zero coverage a real shame. **Drop.**

### 3. gnudb / freedb dump — BEST TECHNICAL PATH (partial coverage)
- gnudb.org is the freedb successor, same CDDB data and protocol
  (https://gnudb.org/, https://gnudb.org/howto.php).
- **Confirmed hit:** `CBEP454-04 / Chartbuster (CB)` exists as a ripped disc entry
  (https://gnudb.org/cd/mif40a9511) — 17 tracks, 2012-era rip of the Oldies EP. Because CDDB
  entries carry per-track titles in rip order, a hit also settles **track numbering and
  artist/title field order** for that disc (DKM, ZMP, TU discs included, when present).
- Live access is awkward: the CDDB HTTP API (`gnudb.gnudb.org/~cddb/cddb.cgi`) is keyed by
  disc TOC hash, not text; the web search UI sits behind a JavaScript proof-of-work
  anti-bot challenge (observed directly — page serves a SHA-256 PoW, difficulty 4).
- **The practical path is offline:** the final full freedb dump
  (`freedb-complete-20200601.tar.bz2`, ~several GB) is preserved on archive.org
  (https://archive.org/details/freedb, https://archive.org/download/freedb) and can be
  grepped for `DTITLE` lines matching `SC\d{4}`, `CBEP\d+`, `DKK`, `ZOOM`, `DKM`, `ZMP`,
  `TU` etc. License: GPL (freedb data license). No rate limits, no ToS exposure, fully local.
- Coverage caveat: only discs someone actually ripped and submitted; 1990s Sound Choice was
  extremely widely ripped, so odds are decent, but this is unmeasured until the grep runs.

### 4. karaoke.info — GOOD DATA, GATED ACCESS
Hosts full songbooks per label — Sound Choice ("entire collection", ATD/DAT/TAD orderings,
2.2–3.2 MB PDFs, version 2023-08), Chartbuster, DK, Zoom, Top Tunes/Turn Up The Music
(https://www.karaoke.info/sound-choice-songbook/, https://www.karaoke.info/dk-songbook/,
https://www.karaoke.info/zoom-songbook/, https://www.karaoke.info/turn-up-the-music-songbook/).
The DAT (Disc, Artist, Title) books are literally the mapping we want. **But:** "only those
with full membership can access [the download buttons]" (stated on the songbook page), the
site 403s non-browser user agents, and it's a hobbyist WordPress site with a Terms Of Use
page — scraping is out. Some assets are openly reachable in `wp-content`
(dk-discs-01.pdf verified HTTP 200). Viable as a **manual** reference (free membership signup,
download PDFs once), not as a pipeline dependency.

### 5. karaokeshack.com — GOOD DATA, UNRELIABLE HOST
Community-built complete disc-ID catalogs per label with accompanying PDF songbooks; the
Sound Choice section spans four pages from SC0001 through the end of the catalog
(https://www.karaokeshack.com/sound-choice/, Wayback-verified; also /dk-series/, /zoom/).
Site returned HTTP 522 (Cloudflare, origin down) on every live attempt during this research.
Usable via Wayback Machine snapshots for a one-time manual pass; unusable as infrastructure.

### 6. OpenKJ (openkj.org / db.openkj.org) — PARSER PRIOR ART ONLY
db.openkj.org is a searchable web DB of purchasable + legacy CD+G tracks with a "SongID"
field (https://db.openkj.org/), but exposes **no API and no dump**, and its purpose is
purchase referral. The OpenKJ desktop app (GPL, https://github.com/OpenKJ/OpenKJ) builds
songbooks from filename patterns — its source contains filename-pattern handling worth a
look for regex prior art (see https://github.com/OpenKJ/OpenKJ/issues/87 on the DB design),
but users configure patterns per-library; there is no published disc-code→song dataset.

### 7. karafun.com / KaraoKloud — NOT USEFUL
KaraFun sells its own catalog with no legacy disc codes (no disc-code hits in search).
KaraoKloud (Karaoke Cloud, DigiTrax) is a licensing/subscription service; DK catalog access
is a paid product (https://www.acekaraoke.com/sdtedkkara.html). Neither maps disc codes freely.

### 8. GitHub community dumps — NOTHING DIRECTLY USABLE
No ready-made Sound Choice/Chartbuster CSVs found. Adjacent projects:
karaokenerds.com has SC brand pages (18,008 offline SC tracks) but browse-only, no disc-code
search, no API/export (https://www.karaokenerds.com/Brand/SoundChoice/,
https://github.com/karaokenerds/music-data-karaoke-song-sheets); scribd hosts an uploaded
"Sound Choice Karaoke Song Catalog" PDF (https://www.scribd.com/document/475795566/soundchoicefile-pdf,
login-walled). Nothing here beats the freedb dump + songbook PDFs.

---

## Constraints recap

| Source | Access | Rate limits / ToS | Old-catalog coverage |
|---|---|---|---|
| freedb dump (archive.org) | one-time download, offline grep | none; GPL data | unknown until grepped; ≥1 confirmed hit (CBEP454) |
| karaoke.info | manual PDF download, membership | ToS page; 403s bots; no scraping | claims *entire* SC/CB/DK/Zoom catalogs |
| karaokeshack | manual, via Wayback | site down (522) | complete SC disc-ID list confirmed |
| MusicBrainz | clean JSON API, CC0 | 1 req/s | ~zero for these labels |
| karaokenerds / OpenKJ / KaraFun / karaoke-version | browse-only or n/a | no API/export | n/a |

## Open questions the manual pass will answer
- Whether `DKK`, `ZOOM011`-style, and `rb`-prefix codes are real label prefixes or this
  collection's own ad-hoc renaming (no public source recognizes any of the three — that
  pattern itself suggests a prior owner's renaming scheme, which would make lookup moot for
  those files).
- Actual freedb-dump hit rate against the real corpus (grep is cheap; run it before deciding
  anything further).
- DKM / ZMP / TU per-disc field order — resolvable per-disc from freedb entries when present,
  otherwise from the karaoke.info DAT songbooks.

---

## Addendum: demand-side measurement (2026-07-09, local)

Counted against the verified post-zip cache (65,832 songs, 875 unparsed):

- **Only 155 cache entries — 59 unique files — are disc-code-only** (no artist/title text
  in the filename at all). These are the only songs for which a lookup is the *only* fix.
- The other ~720 failures contain real words and are candidates for parser passes, not lookup.
- The ~450 silently-inverted DKM/ZMP/TU parses (ticket #3) are an *ordering* problem;
  most are fixable free with a "middle segment looks like `Last, First`" heuristic —
  no external data needed.

Combined with the supply-side findings above: **the automated DB-lookup stage is dropped.**
Maximum rescue is ~59 unique songs against a source landscape with no API. If those 59 ever
matter, the path is a one-time grep of the freedb dump + manual songbook check — a chore,
not a pipeline stage.
