# LLM-Assisted Stage-1 Proposal Triage — Research Findings

**Date:** 2026-09-16
**Question:** Can the local Qwen 27B triage the 244 stage-1 proposals
(`karaoke-app/.cache/stage1-proposals.json`: 68 likely / 80 review / 96
unmatched) so Josh only hand-rules the genuinely ambiguous ones?
**Answer:** Yes — but as the *judge of the ambiguous middle*, grounded by a
deterministic MusicBrainz verify pass. Most records never reach the LLM.
**Sources:** two Sonnet research agents (r/LocalLLaMA via Arctic-shift +
API/docs sweep). Key citations inline.

---

## The architecture (three stages, LLM last)

```
244 records
  │
  ├─ 1. NORMALIZE (deterministic, Node)
  │     filename-parsed artist/title + OCR cardTitle + machine proposal
  │     → strip feat.-clauses into a separate field, punctuation,
  │       leading "The", trailing (SF314-13)-style annotations
  │
  ├─ 2. GROUND-TRUTH LOOKUP (deterministic, MusicBrainz)
  │     GET musicbrainz.org/ws/2/recording?query=artist:"A" AND recording:"T"&fmt=json
  │     — free, no auth; send a real User-Agent or you're capped at 1 req/s
  │     — MB's 0–100 relevance score is a usable confidence signal
  │     — cache every response to a local JSON keyed by normalized query
  │     Fuzzy-compare: Jaro-Winkler ≥0.90 on artist AND token-set ≥0.85 on
  │     title = auto-PASS. No hit anywhere = auto-FLAG (human queue).
  │     Secondary cross-check when MB is ambiguous: iTunes Search API
  │     (no auth, ~20 calls/min — pace it).
  │
  └─ 3. LLM JUDGE (Qwen 27B on :8081) — only the in-between cases
        One record per call. Evidence-first schema. Retrieved MB record
        pasted into the prompt as evidence it must cite.
```

**Verified live by the agent:** the MB query for our hard case returned
"We Are Young" by fun. feat. Janelle Monáe, score 100. All 244 lookups ≈
4 minutes with a proper UA.

**Dead end confirmed:** Sunfly disc tracklists (SF314-style IDs) are not
queryable anywhere — the current sunflykaraoke.com store uses a new SKU
scheme; old-disc tracklists exist only as print books / PDF scans. Disc ID
stays a provenance tag, not a lookup key. (One weak lead: db.openkj.org,
no documented API — not worth it for 244 records.)

---

## The LLM judge design (from r/LocalLLaMA + papers)

Primary thread: "LLM as a judge — how do you trust the judge?"
(reddit.com/r/LocalLLaMA/comments/1vywdio/). Papers: arXiv 2505.12570
(batch position bias), 2203.11171 (self-consistency), 2501.10868
(constrained-decoding distortion); llama.cpp issue #12276.

**Call granularity:** one record per call. Batches of ~90 lose
discrimination toward the tail; even ~30 is worse than singles. 244 short
calls at 40 t/s ≈ 15–25 min unattended.

**Output schema** (flat, enforced via llama-server `json_schema` — solved
and reliable for flat classification schemas): evidence-extraction fields
FIRST, verdict LAST, field order identical on every call:

```json
{
  "filename_artist":  "verbatim substring from filename",
  "filename_title":   "verbatim substring from filename",
  "cardtitle_evidence": "what the OCR title says, or 'illegible/absent'",
  "proposal_artist":  "copied verbatim",
  "proposal_title":   "copied verbatim",
  "agreement": "filename_and_card_agree | filename_and_card_conflict | card_missing_or_illegible",
  "verdict": "confirm | correct | flag_for_human",
  "corrected_artist": "string|null",
  "corrected_title":  "string|null",
  "confidence": "high | medium | low",
  "reasoning_note": "one sentence"
}
```

Quote-then-judge ordering is the load-bearing move: the model must commit
to checkable quotes before it renders a verdict, which blocks the silent
swap to the "famous" version.

**System-prompt framing (the #1 guard):** "The filename and cardTitle are
ground truth for THIS file. Verify the proposal against them — do NOT
identify which version of the song is most famous. If the filename credits
a different artist than the well-known version, trust the filename."
(This is the exact Alyssa-Reid-vs-Gilbert-O'Sullivan failure, and it's the
documented parametric-prior-override failure mode — same one we hit in the
Hermes trials, memory [[hermes-8b-ground-truth]].)

**Sampling:** temp 0–0.2. Thinking mode: the judge thread flagged long
reasoning traces as a drift source on mechanical tasks — spot-test
think-on vs think-off on ~5 known-tricky records (Alyssa Reid included)
before the full run.

**Escalation to human (any one suffices):**
- `agreement = filename_and_card_conflict`
- `confidence = low`
- `verdict = correct` while its own evidence fields don't support it
  (self-contradiction catch)
- rerun disagreement: run ambiguous cases twice at low temp; any field
  mismatch escalates. (Self-consistency catches *instability*, not
  *systematic* bias — a confidently-wrong prior override passes twice,
  which is why the evidence-field rules above exist too.)

**Logging:** JSONL, one line per record, full raw model response — so a
post-run spot-check over `flag_for_human` + a random 10% of `confirm`
needs no re-querying. Tests and logs are the eyes.

---

## Failure modes, ranked

1. **Parametric-prior override** — guard: evidence-first schema + explicit
   framing + MB record in-prompt.
2. **Field-order / batch-position bias** — guard: singles, fixed order.
3. **Silent JSON drift** — guard: server-side grammar + hard-fail parse
   check in code (fail → human queue, never best-effort).
4. **Overconfident self-agreement** — guard: evidence-content rules, not
   just rerun agreement.
5. **Reasoning-mode drift** — guard: the think-on/off spot test first.

## Deps / stack notes

- Fuzzy matching: hand-roll Jaro-Winkler (~30 lines, zero-dep — fits the
  repo's dep-cut direction) or `strsimkit` (maintained; the old
  `string-similarity` package is archived). Token-set ratio for titles,
  Jaro-Winkler for artists.
- MB rate limits: wiki.musicbrainz.org/MusicBrainz_API/Rate_Limiting.
- iTunes: itunes.apple.com/search?term=...&entity=musicTrack, ~20/min.
- Qwen must be up on :8081 (`swap-server.ps1`).

## Status

**Stages 1–2 BUILT + RUN 2026-09-16** — `karaoke-app/scripts/mb-verify.js`
(+ `fuzzy-match.js`, both unit-tested; report `.cache/mb-verify.json`,
MB lookups cached in `.cache/mb-cache.json`). Result over the 244:

- **confirmed 76** (MB knows the proposed pairing, no better-evidenced rival)
- **corrected 2** (proposal replaced by a filename-backed MB artist)
- **resolved 8** (unmatched records where filename + MB name one artist —
  includes wins like `G13974 Technologic` → Daft Punk and the
  underscore-mangled SC files)
- **ambiguous 101** — the LLM-judge pile (stage 3, not built yet);
  MB evidence for each is already cached
- **flagged 57** — 45 with no MB recording for the title (obscure/OCR
  garbage like "Great head on her"), 12 with no title to search at all;
  straight to the human queue

Ops note: MB 503-rate-limits a 1.1s gap even with a proper UA; 2s is
clean. Failed lookups are never cached, so reruns retry only the gaps.

**Artist-scoped second query added same day:** popular titles bury the
right artist below MB's 15-hit page (fun.'s "We Are Young" returned only
covers), so proposal records whose artist is missing from the title-only
hits get a second `artist:"X" AND recording:"T"` lookup. Result: ambiguous
101 → 67, confirmed 76 → **110** (final: 110/2/8/67/57).

**Stage 3 BUILT + RUN 2026-09-16** — `scripts/llm-judge.js` (+ 9 tests).
Qwen 27B on :8081, one record per call (~13 s, no-think via
`chat_template_kwargs`, temp 0.2, server-side json_schema; thinking mode
truncated outputs in the smoke test — the research's prediction held).
Evidence-first schema, and **every verdict is receipt-validated in code**
(`validateReceipts`): quoted evidence must actually appear in the
filename/card, confirms need an evidence source, corrections must be
BOTH MB-known and file-backed. Receipt failures demote to the human
queue with the model's suggestion attached. Resume-safe rounds
(`--limit N`); raw responses in `.cache/llm-judge-log.jsonl`.

Judge run over the 67: **confirmed 5, corrected 1** (the PRESLEY, ELVIS
"Tomorrow Night" file the matcher had given to Lonnie Johnson),
flagged 45, receipt_failed 16. The demotions are the guardrail working —
e.g. the model suggested "911" for `911 - Private Number` (plausibly
right) but MB couldn't corroborate, so it went to the queue with the
suggestion visible instead of being trusted.

**E2E harness BUILT 2026-09-16** (Sonnet builder + Fable advisor review) —
`scripts/triage-pipeline.e2e.test.js`: both scripts run as real child
processes against in-test mock MB + judge servers (offline, <1 s, in the
`npm test` glob). Proves the wiring end-to-end: tier bucketing, the
artist-scoped second query (asserts two distinct queries), lookup
caching, User-Agent policy, receipt demotion with the model verdict
attached, resume-skip on rerun, full-chain "every record lands in
exactly one bucket," and before/after hashes proving `overrides.json` /
`library-cache.json` stay untouched. Seams added for testability:
`MB_ENDPOINT` / `MB_REQUEST_GAP_MS` / `JUDGE_URL` env vars, `--cache` /
`--log` flags (defaults unchanged). A live smoke (`RUN_LIVE_JUDGE=1`)
replays the Alyssa Reid trap against the real :8081 — functionally
verified in the advisor run (correct verdict, receipts passed); note the
model may quote artist casing from filename or MB interchangeably.

**Sample pass + CDG-card audit 2026-09-17 — the confirmed bucket
FAILED its sample and got fixed.** Josh's 10-record sample surfaced one
wrong confirm (`talking heads-road to nowhere` → Ozzy Osbourne); a scan
found 24 confirms sharing the risk shape (MB-only backing + unexplained
filename words). **CDG eyes:** `cdg-snapshot.js --scan` rendered the 24
files' title cards; two Sonnet vision agents read them (rule: writer
credits ≠ performer credits). Verdicts: **7 proven wrong** (incl. Lady
Gaga vs the real Rabbitt/Gayle duet, Maurice Williams vs Lisa Loeb, two
"Traditional" cards, and an Elvis file that's likely Kiri Te Kanawa),
2 vindicated by "in the style of" credits, 15 card-silent. Full table:
`.cache/card-audit-2026-09-17.json`. **Fix:** `judgeRecord` now demotes
MB-only confirms whose filename carries unexplained words
(`unexplainedFilenameWords`, unit-tested on the Talking Heads case);
rerun moved 110 → 98 confirmed, all seven convicts demoted. Method
lesson: Sound Choice cards carry performer credits ("IN THE STYLE
OF..."); DK/Legends/Music Maestro cards are writers-only — CDG eyes
resolve SC disputes outright but stay silent on most DK-style discs.

**Final rollup of the 244 (post-fix):** 98+2+8 deterministic + 5+1 LLM
(LLM run predates the demotion; the 12 newly-demoted records carry card
verdicts for Josh instead of a judge rerun) — remainder to Josh's queue
with evidence attached.

**Old rollup (pre-audit, for the record):** 126 machine-settled
(110+2+8 deterministic, 5+1 LLM) · 118 for Josh (57 no-MB-hit,
45 judge-flagged, 16 receipt-demoted — each with its evidence and any
model suggestion in the reports). Remaining human steps: Josh's
per-bucket sample pass (layer 3 of the guarantee ladder), then promotion
via his manual gate.
