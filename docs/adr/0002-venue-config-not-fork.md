# ADR 0002 — Venue preferences are config flags, not a fork

**Status:** accepted (2026-07-13)
**Context:** Shooter (the DJ, primary venue) doesn't want key changes or
multiple versions surfaced — "it removes the fun for people." His read: a dive
bar shouldn't feel competitive; type name, pick song, sing.

## Decision

Venue-level preferences live in a **settings/config file** (feature flags),
not a git branch or fork. First flag: `enableKeyChange` — off for Shooter's
venue. Version display (`showVersions` / collapse-to-one-per-songKey) is the
next candidate flag when it comes up.

## Why

- A "Shooter's version" branch means every fix and feature lands twice, and
  the branches drift until merging is a nightmare. Forks are for divergent
  products; this is a preference.
- The songKey grouping (ADR 0001, tickets #12/#14) makes version-collapsing
  cheap: serve the best file per songKey, hide the picker.
- Flags keep the door open — if Shooter changes his mind, or another venue
  wants the competitive experience, it's a flag flip, not a merge.

## Reversal cost

Near zero. A flag can be removed or defaulted differently at any time. The
rejected alternative (fork) is the one with the compounding cost.

## Considered alternative

Per-venue git branch: rejected for maintenance drift and double-landing of
every future change.
