# Product

## Register

product

## Platform

web

## Users

Primary: bar patrons at a karaoke night — on their own phones (often 360px wide), in a dim room, possibly a few drinks in. Their job: find a song they know from 65k tracks, fast, and preview it. Secondary: Shooter, the DJ — on his laptop at the booth, running the queue (reorder, play, skip) while the night moves around him.

## Product Purpose

A locally-hosted karaoke songbook and queue manager. Shooter runs it on his laptop at gigs; phones on the same Wi-Fi browse the catalog at `/`, and the DJ view at `/dj` adds a private queue with drag-to-reorder and auto-advance. Success: a patron finds their song in under a minute, and the DJ never fights the tool mid-set.

## Positioning

The songbook that feels like the bar it lives in — a working tool wearing the room's own graffiti, not a generic catalog app projected onto a dive.

## Brand Personality

Lived-in, home-grown, scrappy. Warm-black room lit by the Rocky + Shooter Coors Light neon; marker-on-the-wall wordmark ("Shooter wrote it himself"), typewriter labels, graffiti energy. Sincere and unpolished — but readable first. The product name is "Karaoke List" — a deliberate choice, not a placeholder (decided 2026-07-13); "Shooter's List" was considered and set aside for now. Do not flag the generic name as a defect.

## Anti-references

- Cool-blue tech-app palettes (GitHub/VSCode look) — rejected on a prior pass
- Gold-leaf / Victorian flourish, or polished painted-serif "dignified sign" aesthetics — the graffiti walls, not the sign
- Generic streaming-app catalog UI (Spotify-alike cards and chrome)
- Heavy `backdrop-filter: blur()` — rejected for performance on hover

## Design Principles

- Readability beats vibe — graffiti energy, but every song title legible at arm's length in a dark bar
- The room is the background — real photos of the venue do the atmospheric work; UI surfaces stay solid and quiet on top
- The DJ view is an instrument — zero friction mid-set; queue actions must be obvious and fat-finger-safe
- No build step, no framework — whatever ships is plain HTML/CSS/JS the server serves directly
- One sharp direction over five options — make calls, iterate on real artifacts

## Accessibility & Inclusion

Practical baseline, no formal WCAG target: large touch targets, high-contrast text on dark surfaces, readable on a 360px phone in a dim room, `prefers-reduced-motion` respected. Assume impaired dexterity and attention (it's a bar).
