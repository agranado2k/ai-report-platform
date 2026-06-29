# ADR-0058: "Forge & Ember" warm-dark design system

- **Status**: Accepted (2026-06-29) — amends ADR-0050
- **Deciders**: operator
- **Date**: 2026-06-29

## Context and problem statement

ADR-0050 established the app's design system (Tailwind v4 + CSS-first tokens in
`apps/app/app/styles/theme.css`) with a placeholder identity: a Linear-style
indigo (`#5e6ad2`), Inter, light theme, and "light theme only / no public
marketing page / shared `packages/ui` deferred" scope notes. The product now has
a real name (**Centaur**) and domain (`centaurspec.com`, cutover PR #107) but no
brand identity. We want a distinctive look that expresses the product thesis —
**humans + AI collaborate to author and annotate specs; augment the human, don't
replace them** — and deliberately avoids the cold-blue "robot AI" cliché.

## Decision drivers

- Express "augment, not replace" — warm, human, craft-forward; not cold sci-fi.
- Differentiate from the sea of cyan/indigo AI products.
- Keep the re-theme low-risk: no component churn, no new runtime deps.
- Reuse the existing token mechanism (ADR-0050) rather than replace it.

## Considered options

1. **Keep the Linear-indigo light theme** — safe, but generic and off-thesis.
2. **Parchment & Ink** (warm light, editorial) — strong for documents, but light
   themes read less "tool-like" for a power-user dashboard.
3. **Centaur Duotone** (amber↔violet aurora) — on-thesis but keeps a cold violet.
4. **Forge & Ember** (warm dark, copper/ember) — warm, premium, maximally
   differentiated; warm-dark suits a dashboard stared at all day.

## Decision outcome

Chosen: **option 4, "Forge & Ember"** — a **warm-dark** identity, validated with
the operator via published mockups before implementation.

- **Palette** (`:root` primitives in `theme.css`): bg `#1a1410`, surface
  `#241c16` / raised `#2c231b`, text `#f2e9dc` / muted `#c6b9a6` / subtle
  `#9a8b78`, brand copper `#c8762d` → hover ember `#e8a04c`, on-brand `#231405`,
  accent sage `#8a9a7b`, warm-retuned success/warning/danger.
- **Warm-dark is the DEFAULT** — `:root` carries the dark palette directly (no
  toggle needed). A future light mode would be an additive `.light {}` block; the
  `@custom-variant dark` hook is retained.
- **Mechanism unchanged from ADR-0050**: primitives → `@theme inline` → Tailwind
  utilities by reference, so the re-theme is **zero component-class changes**. New
  tokens: `--color-accent` (sage) + `--font-serif` (system serif for brand/display;
  UI stays Inter, code stays JetBrains Mono — no new font files vendored here).
- **Clerk** `appearance` hexes (`root.tsx`) updated to the warm-dark values (Clerk
  needs literals, not `var()`), resolving the prior `TODO(dark)`. **Amended (PR #125):**
  the variable overrides alone left Clerk's *computed* neutrals (account-menu items,
  icons, dividers) on light defaults — so Clerk uses `@clerk/themes` `dark` as
  `baseTheme` with the Forge & Ember `variables` layered on top.

## Consequences

- The entire app re-skins to warm-dark from a single token file; risk is low (no
  class churn) but the change is visually total — verify the dashboard, upload,
  api-keys, sign-in, and error screens on the preview.
- Brand chrome (Centaur logomark/wordmark + top bar + avatar dropdown), an SVG
  icon set (replacing emoji), the inline title-rename interaction, and the
  Settings/MCP-tokens reskin are **follow-up PRs**, not part of this token PR.
- Supersedes ADR-0050's "light theme only" scope note. The "shared `packages/ui`"
  and "no marketing page" notes remain deferred (a marketing app is parked).

## More information

Direction chosen from web research (Linear/Cursor equal-footing framing,
Anthropic/Granola warmth, FigJam/Hypothesis annotation-in-the-margins) and
operator review of three candidate palettes; Forge & Ember (warm dark) selected.
