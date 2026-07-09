# ADR 0001 — Song identity: per-file IDs + grouping key

**Status:** accepted (2026-07-09)
**Context:** wayfinder charting for the metadata cleanup pipeline

## Decision

Song identity stays **per-file**: `id` remains the SHA-1 hash of the file path
(`makeId` in `karaoke-app/server/library.js`). Deduplication is expressed as a
**separate grouping key** (`songKey`, normalized artist+title or better) added
alongside — never by merging files into canonical "song" entities.

## Why

- The queue (`server/queue.js`) references `songId`; search and both frontends
  consume the per-file shape. Canonical entities would touch all of them at once.
- Grouping is additive: nothing existing breaks, and the current serve-time
  `versions` counting in `server/index.js` becomes a consumer of the key rather
  than its own ad-hoc grouping.
- A queue entry must always point at a concrete playable file.

## Reversal cost

Moving to canonical song entities later means migrating queue references,
search results, and both frontends — moderate, but the grouping key is a
stepping stone toward it, not a dead end.

## Considered alternative

Canonical song entities owning their files: conceptually cleaner, rejected for
blast radius at this stage.
