# Brief for Claude (Design pass) — Shooter's List

Paste this whole document into a fresh Claude conversation along with the 6 photos in `karaoke-app/Visual Board/`. Ask Claude to either generate **mockups** (image generation), **a refined design spec** (text + color/typography tokens), or **a concrete revised CSS file**.

---

## What this is

A locally-hosted karaoke web app for a DJ named Shooter (his real name; he goes by it). The DJ runs it on his laptop at gigs; phones on the same Wi-Fi load it. There are **two views**:

- `/` — **Audience.** Browses the song catalog, previews songs on their own phone. No queue, no requests in the app — requests happen on paper to the DJ in person.
- `/dj` — **DJ booth.** Same catalog plus a private queue panel (drag-to-reorder, auto-advance, skip).

Tech: plain HTML/CSS/JS on top of a Node/Express server. **No framework, no build step.** Whatever CSS you propose ships directly. Fonts via Google Fonts. Photos served from `/public/img/`.

---

## Visual target

**"Lived-in / home-grown / scrappy."** The DJ's home venue is **The Brewery** in State College, PA — a college-town dive bar. Photos are attached. The aesthetic should feel like the room: dim, warm-black, red-neon-lit, with graffiti walls, taped-up bulletin boards, and Shooter's "Rocky + Shooter" Coors Light neon sign as the visual anchor.

The brand is **"Shooter's List"** — venue-agnostic so it travels with him when he DJs elsewhere.

### Specific direction (decided with the user)

- **Photos used:** Brew 5 (Rocky + Shooter neon, the main backdrop), Brew 1 (bulletin board, corner accent), Brew 4 & 6 (graffiti walls, corner accents)
- **NOT used:** Brew 2 (THE BREWERY classical painted sign) and Brew 3 (David mural) — too dignified for this direction
- **Scrappy flavor:** **graffiti / spray-paint tag**. Not Victorian, not chique-painted-serif, not photocopied-Xerox
- **Wordmark style:** **handwritten / marker** — looks like Shooter himself wrote it in Sharpie on the wall. Currently using `Permanent Marker` Google Font; open to alternatives
- **Tagline:** kept as-is ("Karaoke • Songbook" small caps in `Special Elite` typewriter). User likes this.

### What's been rejected on previous passes

- ❌ Cool-blue tech-app palette (looked like GitHub/VSCode)
- ❌ Gold-leaf wordmark with Victorian flourish (too refined)
- ❌ Polished painted-serif "THE BREWERY" sign aesthetic (the user wants the *graffiti* walls, not the sign)
- ❌ Heavy `backdrop-filter: blur()` everywhere (perf killer on hover)

---

## Current state (v3 of the redesign)

You can see the current implementation in `karaoke-app/public/styles.css`. The user said v3 is "closer but still not my aesthetic" — they want sharper, more directly photo-driven, more graffiti energy. **Not asking for incremental tweaks** — open to a real visual direction shift.

### Palette in use
- Background: warm black `#0a0807`
- Text: cream `#f5e8d1`, white `#ffffff` for emphasis
- Primary accent: Coors red `#ff3b2f` with red glow `rgba(255,59,47,0.6)`
- Secondary accent: amber `#ffb627`
- Surface: `rgba(10,7,5,0.92)` over photo bg

### Type stack
- Headlines: `Permanent Marker` (Sharpie style)
- Body: `Inter`
- Small labels / disc codes / hints: `Special Elite` (typewriter)

### Layout structure
- Wordmark "Shooter's List" centered with a hand-drawn marker squiggle underline
- Tagline below in small caps
- Search input → status line → song list (semi-transparent dark panel)
- DJ page adds: queue panel below the song list, with drag handle (≡), play (▶), remove (×) per row
- Player overlay covers full screen with audio + canvas + Skip/Close buttons
- Background: Brew 5 fills the viewport (dimmed). Three corner divs show Brew 1, 4, 6 tilted at random angles. SVG noise overlay.

---

## What we'd love from a design pass

Any or all of:

1. **A sharper photo-collage strategy.** The current corner-photos approach feels okay but soft. Maybe a more aggressive composite (torn-paper edges, overlapping with graffiti as the literal "background of the room"). A reference moodboard or a single hero composite is welcome.
2. **Wordmark exploration.** Permanent Marker is OK but might not be *the* answer. Show 3–5 wordmark options that match "Shooter wrote his name on the wall" — could be marker, could be a stencil, could be spray-paint, could be a custom logotype.
3. **Refined button + tag accents** that read as graffiti without being illegible (the user values readability).
4. **Spec-level deliverable** if going that route: color tokens, type scale, spacing rhythm, component specs. The implementer just needs unambiguous values.
5. **Concrete CSS file** if you want to go all the way — replace `public/styles.css` with a sharper version. Keep all CSS selectors that exist (don't rename — would break the existing HTML).

---

## Constraints

- Two HTML files: `public/index.html` (audience), `public/dj.html` (DJ). HTML structure is mostly fixed — selectors are what they are. Style around what's there.
- Class names that must keep working: `.wordmark`, `.wordmark h1`, `.tagline`, `.role-pill`, `.sub`, `input.search`, `.status`, `ul.songs`, `ul.songs li`, `.info`, `.artist`, `.title`, `.disc`, `.actions`, `.play-btn`, `.queue-btn`, `.empty`, `section.queue`, `.queue-header`, `.count-badge`, `.clear-btn`, `ul.queue-list`, `.qrow`, `.drag-handle`, `.qpos`, `.qinfo`, `.qartist`, `.qtitle`, `.remove-btn`, `.player`, `.player .now`, `.up-next`, `.player canvas`, `.player audio`, `.player .close-btn`, `.player .skip-btn`, `.player .hint`, `.bg-deco`, `.bg-deco-1`, `.bg-deco-4`, `.bg-deco-6`
- Drag UI uses SortableJS, which adds `.qrow-chosen` and `.qrow-ghost` mid-drag — those need styling
- No backdrop-filter (perf). Use solid translucent rgba instead.
- Photos available at `/img/brew1.jpg`, `/img/brew4.jpg`, `/img/brew5.jpg`, `/img/brew6.jpg`. Sizes: ~200–700 KB each (we can compress if needed).
- Must remain readable on a 360px-wide phone screen.

---

## Reference: the photos

(Attach the 6 JPGs from `Visual Board/` when sending this brief. They're the source of truth for "what the room looks like.")

1. **Brew 1** — bulletin board, pinned papers, hand-written phone numbers, cartoon beer mug. Layered ephemera.
2. **Brew 2** — hand-painted "THE BREWERY State College" sign + sandstone statue. *(Decided not to use heavily — too dignified.)*
3. **Brew 3** — David mural with beer next to Men's room. *(Decided not to use.)*
4. **Brew 4** — graffiti wall: Noodle, RIP Sharkys, TITS, AXF, etc. Scratched and markered names.
5. **Brew 5** — Rocky + Shooter Coors Light neon. Red glow in a dark booth. **The visual anchor.**
6. **Brew 6** — "The Brew" + "Beer is terrible" + "Ask for Sho's Sauce" + signatures wall.

---

## Tone notes

Working-style preferences:
- Clear, concrete deliverables — *one* sharp direction, not five options to choose between
- "Why" explained briefly (a sentence per choice, not a paragraph)
- Iterating on real artifacts, not theory

Avoid:
- Generic "moodboard with 12 fonts and a Pinterest spread"
- Over-asking — make calls
- Trying to do too much in one pass

If outputting CSS, output the **whole file**, not a diff. Easier to apply.

---

## How to get there in the conversation

A reasonable prompt to send Claude alongside this brief and the photos:

> Read the attached brief and look at the 6 photos. The current site is at the v3 state described. Give me one sharper aesthetic direction — your strongest interpretation of "graffiti / scrappy / Rocky+Shooter neon booth" — and ship it as a complete replacement `styles.css`. Use the photos in the background. Don't ask me to pick from options; just make calls and explain them briefly.
