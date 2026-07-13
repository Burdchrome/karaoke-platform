# Design

Visual system for Karaoke List (v3 — "scrappy / graffiti / home-grown"). Source of truth for tokens is `karaoke-app/public/styles.css` `:root`; this document describes the system those tokens implement.

## Theme

Warm-black dive-bar room lit by red neon. The Rocky + Shooter Coors Light neon photo (`/img/brew5.jpg`) is the visual anchor — used as a small taped-up polaroid logo (top-left) and as the player-overlay backdrop, not as a full-bleed background. Surfaces read as paper and tape on a graffiti wall: slight rotations (−3° to +1°), tape-strip pseudo-elements, dashed dividers, an SVG spray-paint noise overlay at 10% opacity. Readability always wins over texture.

## Color

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0807` | warm black page background |
| `--surface` / `--surface-2` | `#16120d` / `#1f1a12` | panels |
| `--ink` | `#f5e8d1` | body text (cream) |
| `--ink-bright` | `#ffffff` | emphasis, artist names, headings |
| `--ink-muted` / `--ink-faint` / `--ink-stamp` | `#c4ad88` / `#806e54` / `#a18c6f` | secondary text, hints, disc codes |
| `--red` / `--red-bright` / `--red-deep` | `#ff3b2f` / `#ff5346` / `#c01a10` | primary accent — Coors neon red |
| `--red-glow` | `rgba(255,59,47,0.6)` | neon glow shadows |
| `--amber` / `--amber-deep` | `#ffb627` / `#c98800` | secondary accent (skip button, DJ inputs, drag states) |
| `--danger` | `#ff5c54` | destructive hover (remove, clear) |

Red is the neon: it glows (`text-shadow`/`box-shadow` with `--red-glow`), it marks primary actions and focus. Amber is the DJ's marker: secondary actions and queue affordances. Translucent dark rgba panels (`rgba(10,7,5,0.88–0.92)`) over the backdrop — **never `backdrop-filter`** (rejected for performance).

## Typography

| Face | Role |
|---|---|
| `Permanent Marker` (Google) | wordmark, headings, primary buttons, queue positions — "Shooter wrote it in Sharpie" |
| `Inter` | body and list content — the readability workhorse |
| `Special Elite` (typewriter) | small caps labels, taglines, disc codes, hints, secondary buttons |

Wordmark: `clamp(48px, 10vw, 84px)`, rotated −1.5°, red-glow text-shadow, spray-paint SVG underline. Labels run uppercase with wide letter-spacing (0.14–0.5em).

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
