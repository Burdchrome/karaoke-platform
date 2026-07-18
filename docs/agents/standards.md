# Karaoke Standards — project-specific rules

*Rules true of this repo and nothing else. The general rulebook is
`code-standards.md` at the workspace root; it covers everything this file
doesn't mention. **On conflict, this file wins.** A rule lives in exactly one
of the two files, never both. /code-review's Standards axis reads both.*

---

**Rule:** Any change to parse logic or the song-index shape bumps
`CACHE_VERSION` in `server/library.js`.
Why: the scan cache persists across restarts; without the bump, stale entries
built by the old logic keep serving and the change silently doesn't take.

**Rule:** After any metadata/parser change, re-run `npm run measure` and compare
against the canonical baseline in the script's header. Regressions block the
change.
Why: 65k+ songs — no one can eyeball whether a parser tweak helped or hurt.
The instrument is the only honest scorecard.

**Rule:** Manual metadata corrections go in `overrides.json` (keyed by file id
or filename), never as special cases in parser code. Entries should be
library-backed or ear-confirmed, not guessed.
Why: overrides apply at startup with no rescan and survive parser rewrites;
hardcoded exceptions rot inside logic nobody revisits.

**Rule:** Don't grow `server/library.js` further — new functionality gets its
own module. (Standing watch item: split the overrides functions out.)
Why: it's ~530 lines and already past the one-concern-per-file line.
