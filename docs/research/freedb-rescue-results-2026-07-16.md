# freedb Rescue Results — Issue #8 Claude Half

**Date:** 2026-07-16 · **Source:** `freedb-complete-20191203.tar.bz2` (archive.org
`freedb` item, 948 MB — the 20200601 file named in the research doc doesn't exist
there; Dec 2019 is the newest dump in the item). Stream-grepped without extraction;
71 disc entries matched our code prefixes.

Corpus at time of run: 54 unique code-only files (151 cache entries) out of 839
hard failures — list in `code-only-files-2026-07-16.txt`. Down from 59: the #20
parser round rescued a few.

## Verification pass (2026-07-16, same day)

After the first draft, cross-checked every candidate against **the library
itself** — most of these discs have *other* tracks that already parsed with real
artist/title names (`SC8385-01 - Bellamy Brothers - ...`). Those sibling tracks
are a stronger source than freedb: same physical disc, same track numbering, no
listening required. Where a disc had ≥1 named sibling, freedb's ordering was
checked against it before trusting any entry. Script: `find-siblings.js`
(archived on issue #8). This pass caught one off-by-one error and resolved two
spot-checks outright — see below.

## Resolved → in overrides.json (10, all library-backed)

| File | Artist | Title | How confirmed |
|---|---|---|---|
| 311 - Down | 311 | Down | numeric-artist, unambiguous |
| 90210-11 | Bing Crosby | True Love | freedb embedded track-labels + library sibling CB90210-02 confirms offset |
| SC 8385-15 | Billy Crash Craddock | Broken Down In Tiny Pieces | **exact library twin** (SC8385-15 named copy) |
| SC819607 | Ivory Joe Hunter | Since I Met You Baby | **exact library twin** (SC8196-07) |
| sc8544-11 | They Might Be Giants | Particle Man | **exact library twin** (SC8544-11) |
| sc8574-07 | Styx | Grand Illusion | **exact library twin** (SC8574-07) — was a spot-check |
| sc8574-12 | Styx | Lorelei | **exact library twin** (SC8574-12) — was a spot-check |
| cb60126-02 | Ronnie Milsap | Snap Your Fingers | offset confirmed by 3 siblings (CB60126-07/11/12) — **corrected**, see below |
| cb90030-05 | Ronnie Milsap | It Was Almost Like A Song | offset confirmed by 2 siblings (CB90030-04/11); single-artist disc |
| mm6018-04 | The Platters | My Prayer | offset confirmed by 5 siblings; fills a real track-4 gap |

Track mapping (validated on 6 discs): filename track N = freedb `TTITLE(N-1)`
(0-based). CB90210's rip embeds the disc-track number in each title, which pins
the offset directly.

### Error caught by the verification pass
- **cb60126-02** — first draft said *Janie Fricke / She's Single Again* (that's
  track 3). Library siblings CB60126-07/11/12 prove track N = `TTITLE(N-1)`, so
  track 2 = *Ronnie Milsap / Snap Your Fingers*. Fixed.

## Demoted to the listening checklist (freedb unreliable or no anchor)

| File | Freedb said | Why not trusted |
|---|---|---|
| CBEP 454-1-06 | Connie Francis — Among My Souvenirs | freedb's CBEP454 disc-numbering doesn't match this library — proven on disc 2 (freedb=Jerry Butler, library CBEP454-2-06=Weavers). Disc 1 has zero anchors. |
| CBEP 454-1-15 | Doris Day — Secret Love | same disc-numbering mismatch |
| lg 200-03 | Marilyn Monroe — River Of No Return | no library sibling anywhere; freedb-only, not asserted |
| 8133-09 | Indigo Girls — Closer To Fine | freedb "SC8133" is a *different disc* than this library's SC8133 (country); bare "8133" ambiguous; library SC8133-09 is already Mark Chesnutt |
| esp451-4-04 | George Jones — She Thinks I Still Care | disc-identity guess (esp451-4 = ESP451-04?), no anchor |
| CB 7002-03 | (gospel) How Firm A Foundation | disc-id guess; unnamed traditional hymn, no real artist |
| CB 7002-14 | (gospel) Alas And Did My Savior Bleed | same |

Predictions kept here as hints for the listening session, not as facts.

### Ear-session update (2026-07-17)

Josh played the first three in the app — CDG title cards settled them:

- `CB 7002-03` = **Elvis Presley / Farther Along**, `CB 7002-14` = **Elvis
  Presley / Reach Out To Jesus`. Both freedb gospel-hymn guesses were WRONG —
  the real disc is CB70002 (Elvis gospel), and named twins
  (`CB70002-03/-14 - Elvis Presley - ...`) were sitting in the library all
  along under the 5-digit code.
- `esp451-4-04` = **George Jones / She Thinks I Still Care** — disc pinned
  beforehand by library sibling `CBEP451-4-11 - Patsy Cline - Anytime`,
  confirmed on screen, twin on SC2425-07.

All three added to overrides.json (17 entries, 64 tests green). Remaining
true unknowns: `CBEP 454-1-06`, `CBEP 454-1-15`, `lg 200-03`, `8133-09`.
Freedb's scorecard on ear-checked predictions: 1 right, 2 wrong — which is
why the CDG-title-card pipeline (issue #21, `docs/cdg-verification-plan.md`)
is the path for the rest, not more database guessing.

## Misses → listening checklist (37 files)

No freedb entry found (grep confirmed): all `632202`–`632215` (13 files), `826201`,
`867611`, `B04`, `11`, `13`, `cdg06`, `cdg13`, `dk_05-16`, `DK067-15`, `DK11-04`,
`dk67-15`, `DKK002_08`, `DKK003_11`, `ZOOM011_16`, `rb01403`, `SCF2-19-11`,
`SCF2-21-12`, `CB-9066-07`, `CB-9066-09`, `cb60041-01`, `CBEP 459-3-05`,
`CBEP 462-01-12`, `cbep455-5-07`, `PHM-0502C-05`, `MM6371-101`. Plus the 7
demoted above (CBEP 454-1-06/15, lg 200-03, 8133-09, esp451-4-04, CB 7002-03/14)
= **~44 files ≈ one listening session**. Matches the research doc's prediction
that DKK/ZOOM/rb prefixes are likely a prior owner's ad-hoc renaming.

Full filename+id list: `code-only-files-2026-07-16.txt`.

## Second-drive note

When the next 2TB lands: rescan, re-run the extractor
(scratchpad script archived in issue #8), diff against this list. Existing
overrides keep applying — keys are filenames, which survive drive moves.
