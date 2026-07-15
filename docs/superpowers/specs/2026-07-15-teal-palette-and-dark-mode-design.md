# Teal Palette + Dark Mode (Design)

**Date:** 2026-07-15
**Project:** TradeFlow WMS
**Status:** Approved
**Scope:** Cross-cutting UI change, between Phase 3 and Phase 4.

## Goal

Replace shadcn's `neutral` default — where every token is literally chroma 0 —
with a deep-teal brand palette on tinted neutrals, and make dark mode reachable.

## Why

The app reads as "old school" because it has no color at all, not merely a
restrained one. Findings that drove this:

- Every token in `:root` had **chroma 0** (pure grayscale) except `--destructive`.
- `--chart-1` … `--chart-5` were also all gray — Phase 7/8 dashboards would have
  rendered gray-on-gray.
- Dark-mode tokens existed under `.dark` but **nothing ever toggled them**, so
  dark mode was unreachable.

## Decisions (approved)

1. **Brand hue: deep teal.** Drawn from the product's own world (ports, sea
   freight, grain) rather than the indigo every dashboard defaults to.
2. **Tinted neutrals + one confident hue** — not hue-on-primary-only, not a
   fully colored sidebar (which would fight the data).
3. **Wire a real dark mode toggle** (System / Light / Dark).
4. **Set validated chart tokens now** rather than deferring to Phase 7.

### The constraint that drove hue selection

Phase 3 introduced a reserved status palette: **`#fab219` warning** ("near
capacity") and **`#d03b3b` critical** ("over capacity"). The brand hue must stay
clearly distinct from these, or an alert stops reading as an alert. This
excluded amber, orange, and red as brand candidates. Teal is maximally distant.

## Palette

### Brand

| Token | Light | Dark |
|---|---|---|
| `--primary` | `oklch(0.52 0.10 195)` | `oklch(0.72 0.11 190)` |
| `--ring` | teal | teal |
| `--accent` | `oklch(0.95 0.012 195)` | `oklch(0.28 0.02 205)` |

### Tinted neutrals

Surfaces carry a whisper of teal chroma (≤ 0.012) instead of dead gray — enough
to feel deliberate, not enough to compete with dense numbers. Dark mode is a
**cool charcoal, not black** (`oklch(0.19 0.012 215)`, not `oklch(0.145 0 0)`).

| Token | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.995 0.002 195)` | `oklch(0.19 0.012 215)` |
| `--muted` | `oklch(0.96 0.006 200)` | `oklch(0.26 0.014 215)` |
| `--border` | `oklch(0.91 0.007 210)` | `oklch(0.30 0.012 215)` |
| `--sidebar` | `oklch(0.982 0.004 200)` | `oklch(0.17 0.014 215)` |

### Chart tokens — validated

Taken from the dataviz reference theme in its fixed order, with **yellow and red
deliberately omitted** so a data series can never impersonate a status color:

| Slot | Hue | Light | Dark |
|---|---|---|---|
| `--chart-1` | blue | `#2a78d6` | `#3987e5` |
| `--chart-2` | aqua | `#1baf7a` | `#199e70` |
| `--chart-3` | violet | `#4a3aa7` | `#9085e9` |
| `--chart-4` | magenta | `#e87ba4` | `#d55181` |
| `--chart-5` | green | `#008300` | `#008300` |

Dropping yellow/red also improved the numbers materially — worst-adjacent CVD
separation went from **ΔE 10.3 → 40.5** (dark) and **24.2 → 48.8** (light)
versus the default first-five.

Validator output (`dataviz/scripts/validate_palette.js`): **ALL CHECKS PASS** in
both modes — lightness band, chroma floor, CVD separation, and dark contrast.

> **Carry-forward constraint for Phase 7/8:** on the light surface `#1baf7a`
> (2.74) and `#e87ba4` (2.62) are **below 3:1** against the surface. The
> validator marks this WARN — relief required. Those charts therefore need
> legends/direct labels rather than color alone. The dataviz rules mandate a
> legend for ≥2 series anyway, so this is a confirmation, not a new burden.

### Status colors are unchanged

`#fab219` / `#d03b3b` stay **fixed across both modes** — they are reserved,
already validated on both surfaces, and always ship with an icon + text label.

### `--destructive` aligned

Previously `oklch(0.577 0.245 27.325)` — a different red from the status
critical. Aligned to `#d03b3b` so a form error and an over-capacity alert don't
read as two unrelated reds.

## Dark mode

- `next-themes` provider; `attribute="class"` to drive the existing `.dark`
  block; `defaultTheme="system"`.
- `suppressHydrationWarning` on `<html>` — the theme class is applied before
  hydration, which would otherwise be flagged as a mismatch.
- Toggle in the top bar: System / Light / Dark.

## Scope

| File | Change |
|---|---|
| `src/app/globals.css` | All token values (light + dark) |
| `src/app/layout.tsx` | ThemeProvider + `suppressHydrationWarning` |
| `src/components/theme-provider.tsx` | New — next-themes wrapper |
| `src/components/layout/theme-toggle.tsx` | New — System/Light/Dark control |
| `src/components/layout/top-bar.tsx` | Mount the toggle |

**No page or component rewrites.** Every screen already consumes tokens, so the
palette flows through automatically — the payoff of not hardcoding colors
earlier. The only hardcoded colors in the codebase are the reserved status
values in `occupancy-bar.tsx`, which are intentionally fixed.

## Verification

- Every screen (login, dashboard, warehouses, facility, shed history, blocked
  screen) renders correctly in **both** light and dark.
- The occupancy warning/critical states remain legible against the new surfaces
  in both modes.
- Toggle persists across reload; no flash of the wrong theme.
- `npm test`, `tsc --noEmit`, `lint`, `build` clean.

## Out of scope

- Restyling components or layouts — this is a palette change only.
- Applying chart tokens to actual charts (Phase 7/8 — none exist yet).
