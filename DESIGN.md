# Design

Visual system for Karaoke List (v4 — "the scratched wall"). Source of truth for tokens is `karaoke-app/public/styles.css` `:root`; this document describes the system those tokens implement.

## Theme

The actual Brewery graffiti walls (Brew 4/6) are silver scratch-marker on matte black — so v4 desaturates v3's warm-cream cast: ink is chalk-silver, the background is neutral black, and the red neon is the only light in the room. Amber survives only as the Coors-script yellow (DJ-only moments: role pill, singer input, skip, drag states). Cream is reserved for literal paper objects (request slip, tape strips). The Rocky + Shooter neon photo (`/img/brew5.jpg`) stays the visual anchor — small taped-up polaroid logo (top-left) and the player-overlay backdrop. Texture is an SVG of thin scratched lines at odd angles (7% opacity), like years of keys and markers; the wordmark carries a `'26` year tag like every name on the wall. Slight rotations (−3° to +1°), tape-strip pseudo-elements, dashed dividers. Readability always wins over texture.

## Color

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0b0a0a` | matte black wall (neutral, not warm) |
| `--surface` / `--surface-2` | `#141312` / `#1c1a18` | panels |
| `--ink` | `#eceae6` | body text (chalk — the wall's marker color) |
| `--ink-bright` | `#ffffff` | emphasis, artist names, headings |
| `--ink-muted` / `--ink-faint` / `--ink-stamp` | `#b6b2ab` / `#918d85` / `#9c978e` | worn silver: secondary text, hints, disc codes |
| `--red` / `--red-bright` / `--red-deep` | `#ff3b2f` / `#ff5346` / `#c01a10` | primary accent — Coors neon red, the only glow |
| `--red-glow` | `rgba(255,59,47,0.6)` | neon glow shadows |
| `--amber` / `--amber-deep` | `#ffb627` / `#c98800` | Coors-script yellow — DJ-only (role pill, singer input, skip, drag states) |
| `--danger` | `#ff5c54` | destructive hover (remove, clear) |
| `--paper` | `#f0e7d4` | real paper objects only (request slip, tape) |

Red is the neon: it glows (`text-shadow`/`box-shadow` with `--red-glow`), it marks primary actions and focus. Amber is the second neon tube — the DJ's color; the audience view never shows it. Translucent dark rgba panels (`rgba(11,10,10,0.88–0.92)`) over the backdrop — **never `backdrop-filter`** (rejected for performance).

## Typography

| Face | Role |
|---|---|
| `Permanent Marker` (Google) | wordmark, headings, primary buttons, queue positions — "Shooter wrote it in Sharpie" |
| `Inter` | body and list content — the readability workhorse |
| `Special Elite` (typewriter) | small caps labels, taglines, disc codes, hints, secondary buttons |

Wordmark: `clamp(48px, 10vw, 84px)`, rotated −1.8°, chalk-white with red-glow spill, marker SVG underline, plus a small silver `'26` year tag (CSS `::after`) like the wall tags. Labels run uppercase with wide letter-spacing (0.14–0.5em).

## Components

- **Buttons**: spray-paint stickers — near-zero border-radius (1px), slight rotations, uppercase, glow on hover, `translateY(1px)` on press. Primary = solid red Marker face; secondary = outlined red; utility = outlined `Special Elite`.
- **Song list**: translucent dark panel, dashed row dividers, red-wash hover. Artist bright/bold, title muted italic, disc code typewriter (hidden under 520px).
- **Queue panel (DJ)**: "paper taped to the wall" — solid dark surface, tape-strip corners, −0.3° rotation, amber hover accents. SortableJS drag states: `.qrow-chosen` amber wash, `.qrow-ghost` 30% opacity.
- **Player overlay**: full-screen, Brew 5 dimmed under radial vignettes, pixelated CDG canvas framed like a neon-edged TV, amber Skip (left) / outlined Close (right).

## Layout

Single centered column, `max-width: 880px`, mobile-first down to 360px. Breakpoint at 520px: actions stack vertically, disc codes hide, logo shrinks. Content sits at `z-index: 2` above fixed backdrop layers.

## Motion

Small and cheap: 80–200ms transitions on background/shadow/transform only. Hover = glow + 1px lift; active = 1px press. No large animations; respect `prefers-reduced-motion` for anything new.

## Hard constraints

- No framework, no build step — plain CSS shipped as-is
- No `backdrop-filter`
- Existing selectors in `styles.css` must keep their names (fixed HTML in `index.html` / `dj.html`)
- Readable on a 360px phone in a dim bar
