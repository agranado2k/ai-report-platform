# ADR-0086: ClickUp-style light design system

- **Status**: Accepted (2026-08-29) — supersedes ADR-0058
- **Deciders**: operator
- **Date**: 2026-08-29

## Context and problem statement

ADR-0058 gave the app the **"Forge & Ember"** identity: a warm-dark, copper/ember
palette on warm ink, chosen deliberately to express "augment the human, don't replace
them", to avoid the cold cyan/indigo "robot-AI" cliché, and because warm-dark suits a
dashboard stared at all day. That ADR explicitly *rejected* a warm-**light** option as
"less tool-like".

The operator has since decided the product should present differently: bright, light,
and approachable — the aesthetic of the modern SaaS tools they admire, anchored on
**ClickUp**. A five-direction design study was published as a decision aid (report
`BARzwkxkOm`, "Five palettes, one Centaur") — ClickUp, Linear-light, Notion-calm,
Stripe/Vercel-crisp, and a Vibrant/Monday option, each rendered live on real Centaur
screens — and the operator chose the **ClickUp** direction.

This reopens the ADR-0058 decision on purpose. Warm-dark is not wrong; it no longer
matches the identity the operator wants. This ADR records the replacement, honestly, so
future contributors understand *why* the direction changed rather than finding a silently
overwritten token file.

## Decision drivers

- Present a bright, friendly, consumer-grade-SaaS identity — the ClickUp family the
  operator chose from real, applied mockups (not in the abstract).
- Keep the change **low-risk and reversible**: reuse the ADR-0050/0058 token mechanism so
  the re-skin is data, not component churn.
- Make **light the product's default** — a light-first product should carry light on
  `:root`, not bolt light on as an afterthought.
- Record the decision as a first-class ADR (root rule 4: read/record the ADR before
  changing design-system infrastructure).

## Considered options

1. **Keep "Forge & Ember" warm-dark (ADR-0058)** — differentiated and deliberate, but no
   longer the identity the operator wants.
2. **Linear-light** — restrained indigo on near-white; the premium power-tool benchmark.
3. **Notion-calm** — warm neutrals, editorial, document-forward.
4. **Stripe / Vercel** — crisp, high-contrast, technical-premium, gradient accents.
5. **Vibrant SaaS (Height / Monday)** — bold, saturated, multi-color.
6. **ClickUp** — bright violet with pink/sky accents and soft gradients; rounded, playful,
   unmistakably consumer-grade SaaS.

All five candidates (2–6) were rendered on real Centaur screens in report `BARzwkxkOm` and
reviewed by the operator.

## Decision outcome

Chosen: **option 6, ClickUp — a bright, light design system.**

- **Palette** (light; `:root` primitives in the shared `theme.css`):
  - brand violet `#7B68EE` → hover `#5F4FD6`, on-brand `#FFFFFF`;
  - supporting accents pink `#FD71AF` and sky `#49CCF9`, plus a **violet→pink gradient**
    token for hero/CTA moments;
  - surfaces page `#F5F6F8`, surface `#FFFFFF`, raised `#F2F1FD`; borders `#E6E7EB` /
    `#D6D8DE`;
  - text `#2A2E34` / muted `#656F7D` / subtle `#A2ABB8`;
  - semantic success `#2ECC71`, warning `#FFC800`, danger `#E8465E`, info `#49CCF9`;
  - radii control `12px` / card `16px`; **soft, diffuse shadows** (a light ground uses
    shadow for elevation, unlike Forge & Ember's border-led dark elevation);
  - fonts unchanged — Inter (UI) + JetBrains Mono (code); no new faces vendored here.

- **Light is the DEFAULT, and this INVERTS ADR-0058's stated plan.** ADR-0058 said a future
  light mode would be an additive `.light {}` block layered on a dark `:root`. This ADR
  reverses that: **light lives on `:root`** with **`color-scheme: light`** (so native
  chrome — scrollbars, form controls, date/select popups, autofill — renders light), and
  **dark is deferred to a future additive `.dark {}` block**. The `@custom-variant dark`
  hook is retained; **no `.dark {}` values are shipped now.**

- **Mechanism unchanged from ADR-0050/0058**: primitives → `@theme inline` → Tailwind
  utilities by reference. Keeping every token **name** identical makes the re-skin
  **zero component-class changes** across `apps/app` and `apps/view` (which share the token
  file). New tokens (supporting accents + the gradient) are additive.

- **Clerk** `appearance` is re-themed to light: the `dark` `@clerk/themes` baseTheme →
  `light` (the baseTheme is load-bearing for Clerk's *computed* neutrals — menu items,
  icons, dividers), with the ClickUp light literals layered on (`colorPrimary #7B68EE`,
  light background/text). Clerk needs literal hex, not `var()`, so these intentionally
  duplicate the token values.

  **Amendment (2026-08-29, #324):** `@clerk/themes` ships **no `light` export** (its bases
  are `dark`, `shadesOfPurple`, `neobrutalism`, `shadcn`, `experimental__simple`) — light is
  Clerk's *default*. So "light" is achieved by **omitting `baseTheme` entirely**, not by
  `baseTheme: light`; removing the `dark` override restores the light computed neutrals the
  bullet above relies on.

- **Scope**: `apps/app` + `apps/view` chrome, Clerk auth, and the shared `packages/ui`
  component library. **`packages/report-html` (the generated report documents) is out of
  scope** — those documents carry their own per-document styling.

## Consequences

- The entire product UI re-skins to ClickUp-light from the single token file; risk is low
  (no class churn) but the change is visually total — verify the dashboard, upload,
  api-keys, sign-in/sign-up, account menu, error screens, and the viewer on a preview.
- Flipping `color-scheme` to light changes native chrome; confirm scrollbars, date/select
  popups, and autofill on the preview.
- Component polish that tokens can't reach (button affordance on light, an optional
  gradient CTA variant, visually distinct controls) is a **follow-up**, not part of the
  token change.
- Dark mode is now a clean additive follow-up (`.dark {}` + a toggle), not a rewrite.
- **Supersedes ADR-0058.** ADR-0050's token mechanism stands; ADR-0071's "tokens live in
  `arp-ui`" stands.

## More information

Direction chosen from the operator-reviewed design study — report `BARzwkxkOm`, "Five
palettes, one Centaur" — which rendered all five candidates live on real Centaur screens
and extracted each reference's palette from public brand sources. ClickUp's core hexes were
verified against ClickUp's own brand material; Centaur's product neutrals were tuned for
this app. Implementation is decomposed into the token re-theme, the Clerk appearance, and
component polish as separate tickets (PRD #321).
