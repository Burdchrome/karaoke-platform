# ADR 0003: Grouping key sorts artist tokens and folds "&" to "and"

Date: 2026-08-31
Status: accepted (Josh, 2026-08-31)
Amends: ADR 0001 (per-file IDs + grouping key)

## Context

Real duplication reported on the site: the same song appeared as multiple
search results because disc packs write artists differently. Measured over
the full cache (65,818 files / 39,138 groups): ~949 group pairs split by
artist word order ("Puckett, Gary" vs "Gary Puckett"), 41 by "&" vs "And".
This fired the standing ponytail trigger in `makeSongKey` ("no fuzzy
matching — add when a real ungrouped duplicate is reported").

## Decision

Two changes to the grouping key — still exact string match, no fuzzy logic:

1. `normalizeSongField` ignores `&` (already stripped as punctuation) and
   the standalone word "and" in both fields, so "A & B", "A And B", and
   plain "A B" all agree. (A fold-&-to-"and" variant was tried first, but
   it SPLIT 37 currently-grouped songs whose twins omit the "&" — e.g.
   "Peter, Paul & Mary" vs "Peter Paul Mary". Dropping the token merges
   all three spellings and splits nothing.)
2. `makeSongKey` sorts the artist half's tokens. Titles keep word order.

`CACHE_VERSION` 3 → 4 (songKey is cached; the bump forces a rescan).

## Evidence

Verified with the shipped functions against the full cache: 39,138 groups
→ 38,100 (1,038 duplicate site entries removed), zero old groups split.
Every merge cluster was human-screened — zero false merges
(token-permutation collisions between genuinely different artists do not
occur in this library; every and-only title pair is the same song). Codex adversarial pass drove the
design: an earlier variant also stripped feat-clauses, but that piece
carried all the guards (empty-key fallback, with/duet over-matching) for
~4% of the payoff — rejected per ponytail. Trail: issue #23,
`.cache/merge-simulation*.md`, `analysis-scratch/`.

## Consequences

- ~1,008 duplicate entries collapse into version lists after the next
  rescan (needs E:\karaoke mounted).
- Deliberately NOT handled, each with its trigger to revisit:
  - feat-clause placement (~47 dupes) — new ponytail marker in makeSongKey.
  - blank-artist duplicates (152 pairs) — parse failures; shrinking via the
    overrides/cdg-harvest pipeline (#21).
  - hyphen variants ("Zeta-Jones" vs "Zeta Jones") — pre-existing split,
    revisit if reported.
- Theoretical risk accepted: two genuinely different artists whose names
  are token permutations would merge. Screened absent from this library;
  if one ever appears, overrides can rename it apart.
