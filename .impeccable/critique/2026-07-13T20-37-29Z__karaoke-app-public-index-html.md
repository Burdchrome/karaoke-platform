---
target: audience view (karaoke-app/public/index.html)
total_score: 26
p0_count: 2
p1_count: 2
timestamp: 2026-07-13T20-37-29Z
slug: karaoke-app-public-index-html
---
Method: dual-agent (A: design review · B: detector/evidence)

# Critique — Shooter's List, audience view (`karaoke-app/public/index.html`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Primary feedback line (`.status`) is 11px `--ink-faint`; no in-flight search state |
| 2 | Match System / Real World | 3 | "disc code" is DJ jargon in the patron-facing placeholder |
| 3 | User Control and Freedom | 3 | Only documented player exit is "Press Esc" — phones have no Esc |
| 4 | Consistency and Standards | 3 | Page says "Karaoke List"; the brand is "Shooter's List" |
| 5 | Error Prevention | 3 | Debounce, stale-request guard, seek clamp — solid |
| 6 | Recognition Rather Than Recall | 3 | Disc codes hidden <520px, but patrons need them for paper requests |
| 7 | Flexibility and Efficiency | 2 | Hardcoded 50-result cap, no browse path, no search clear |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained — but undershoots the graffiti brief |
| 9 | Error Recovery | 1 | Raw `fetch` error text in 11px faint type is the whole failure story |
| 10 | Help and Documentation | 3 | One good doc line up top; Esc hint is desktop advice |
| **Total** | | **26/40** | **Acceptable — solid bones, weak feedback + skin** |

## Anti-Patterns Verdict

**LLM assessment:** ~60% believable as human-made. The texture layer (tape strips, tilted polaroid logo, hand-drawn SVG underline, three-font system) is sincere craft. But the composition is the stock centered-column search page, the graffiti is decoration on a template skeleton, and the brief's "photo-driven" amounts to one 88px thumbnail. Worst tell: the brand name never renders — `index.html` says "Karaoke List" while a styled `.apostrophe` selector for "Shooter's" sits dead in the CSS.

**Deterministic scan:** 1 finding per page — `overused-font` (Inter) at `index.html:15` / `dj.html:15`. Arguably a false positive here: Inter is deliberately the neutral body face under two display faces. Noted, not actioned.

**Where they converge:** the detector's hard measurements confirm the review's persona failures — `.play-btn` white-on-red is 3.55:1 (fails 4.5:1 at 13px), `--ink-faint` on bg is 4.07:1 (fails at the 10–13px sizes it's used at), and all three action buttons compute to ~25–30px tall at ≤520px against the 44px guideline. The 520px media query *shrinks* the primary targets.

**Browser overlays:** not run (no injection this pass — static-source critique).

## Overall Impression

The bones are genuinely good — state handling, progressive disclosure, restraint. The skin is a dark theme with handwriting fonts, not the wall of The Brewery. And the single highest-leverage fix is one line of HTML: putting the product's own name on the page.

## What's Working

1. **The player overlay** — Brew 5 under vignettes, neon-edged CDG canvas. The only surface that achieves the brief; should be the template for the rest.
2. **State discipline in app.js** — debounce + stale-request guard, 30s preview cap with seek clamp, clean audio teardown.
3. **Version grouping** — collapsed by default with counts and `aria-expanded`; right-sized for 65k songs.

## Priority Issues

- **[P0] The brand isn't on the page.** `<h1>` renders "Karaoke List"; PRODUCT.md and the dead `.apostrophe` CSS both say "Shooter's List". *Fix:* `<h1>Shooter<span class="apostrophe">'</span>s List</h1>`, update `<title>`, give the tagline a voice. *Command:* /impeccable clarify
- **[P0] Google-CDN fonts on a LAN-hosted app.** If bar Wi-Fi has no internet, all display faces fall back to system fonts and render blocks — the whole aesthetic has one external point of failure. Rock Salt is loaded and unused. *Fix:* self-host woff2 with `font-display: swap`; drop Rock Salt. *Command:* /impeccable optimize
- **[P1] Primary touch targets ~25–30px** (44px floor), and the contrast on `.play-btn` (3.55:1) and `--ink-faint` text (4.07:1) fails WCAG at the sizes used. *Fix:* `min-height: 44px` on row actions, grow (don't shrink) at 520px, darken red or bump font weight/size, retire `--ink-faint` for body-adjacent text. *Command:* /impeccable audit → polish
- **[P1] Preview-end is invisible.** The 30s cap communicates via an 11px faint hint swap; a tipsy patron reads it as a crash — and the "go tell the DJ" hand-off never appears at the moment of decision. *Fix:* high-visibility end state on the player ("That's the preview — like it? Go tell the DJ" + big artist/title/disc). *Command:* /impeccable harden + delight
- **[P2] "Photo-driven" is 88 pixels wide.** The page backdrop is a flat gradient; the room only exists in the logo and player. The readability rig (solid 88–92% panels) was built to survive a photo backdrop and is still there. *Fix:* heavily-dimmed venue photo as fixed backdrop behind existing panels; more aggressive collage treatment. *Command:* /impeccable bolder

## Persona Red Flags

**Casey (one-handed mobile, slow Wi-Fi):** 26px play buttons repeated 50× down the page; Close button top-right, opposite the thumb; four CDN font families blocking render on bar Wi-Fi; native `<audio controls>` scrubber is the worst one-handed control available.

**Jordan (first-timer):** `autofocus` pops the keyboard over the wordmark on load; "find the DJ" instruction scrolls away before the moment it's needed; initial "Type to search" status contradicted by the preloaded 50-song list.

**Tipsy patron, 11pm:** song *titles* — the thing patrons scan for — are the muted italic element; 10–13px faint text is effectively invisible in dim + glare; silent preview pause → tap play → instant re-pause = "broken app," phone pocketed, request lost.

## Minor Observations

- "…or disc code" placeholder while `.disc` is hidden under 520px
- "Press Esc to close" shipped to a phone audience
- Noise overlay z-index sits below content, contradicting its own comment (styles.css:118)
- Dead code: `.bg-deco` kill-switch, unused `.apostrophe`, unused Rock Salt
- Voice consistency drift in status strings

## Questions to Consider

1. If the wordmark were Shooter's *actual* handwriting — photographed marker, not a Google font — would you need any of the CSS graffiti tricks?
2. The player proves photos + panels + readability coexist. Why does the page patrons stare at for 55 of their 60 seconds get none of it?
3. Success ends with a paper slip — should the preview's end-state *be* the request slip (big artist/title/disc, "show this to the DJ")?
