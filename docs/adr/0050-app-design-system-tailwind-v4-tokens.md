# ADR-0050: App design system — Tailwind v4 + CSS-first design tokens

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: agranado2k
- **Supersedes / amends**: —
- **Relates to**: ADR-013 (security headers / CSP), ADR-0048 + issue #65 (app-origin CSP vs Clerk).

## Context and problem statement

The app (`apps/app`) had **no styling system**: every screen used inline `style={{}}` objects with a repeated `system-ui` font and ad-hoc hex values; no fonts, no components, no error page, and Clerk rendered with its default theme. The operator wants a modern SaaS look (à la Linear / Vercel / meetblueberry) that is **easy to re-theme later**. We need a styling approach that is maintainable, token-driven, and compatible with the app-origin security headers.

## Decision drivers

- **Re-theming must be a one-place edit** (the operator's explicit ask).
- **CSP / Trusted-Types compatibility** (ADR-013): the app-origin CSP is `font-src 'self' data:` (remote font CDNs blocked) and intends to tighten `style-src` away from `'unsafe-inline'` later; Trusted-Types (`Trusted-Types: default react`) is enforced. → favour **static, build-time CSS** and **self-hosted fonts**; avoid runtime CSS-in-JS.
- **Dependency policy**: prefer build-time devDependencies over runtime deps (ADR/CLAUDE.md boundaries).

## Considered options

1. **Tailwind v4 with CSS-first `@theme` tokens + `@tailwindcss/vite`** (chosen).
2. Zero-dep CSS variables + hand-written CSS — most future-proof, no deps, but slow to build the polished look.
3. shadcn/ui (Tailwind + Radix) — best out-of-the-box, but Radix primitives are **runtime** deps (heavier review + Trusted-Types risk).
4. PostCSS-based Tailwind / a CSS-in-JS runtime — rejected (PostCSS is superseded by v4's Vite plugin; CSS-in-JS leans on `'unsafe-inline'` we plan to drop).

## Decision outcome

- **Tailwind v4** via the **`@tailwindcss/vite`** plugin (NOT PostCSS), added as **devDependencies** (`tailwindcss`, `@tailwindcss/vite`) — build-time only, emits a static stylesheet served from `'self'` (CSP-clean).
- **Design tokens are the single source of truth** in `apps/app/app/styles/theme.css`: primitive values are CSS variables on `:root`; `@theme inline` maps them to Tailwind utilities **by reference** (`bg-surface`, `text-muted`, `rounded-card`, `font-sans`, `shadow-md`, …). Re-theming = edit that file.
- **Light-first, dark-ready**: a `@custom-variant dark` ships now (inert); adding a dark theme later is a `.dark { --…: … }` block + a toggle, **zero component-class changes** (the `@theme inline` → `var()` indirection is what enables this).
- **Self-hosted fonts** (`apps/app/public/fonts/*.woff2`, Inter + JetBrains Mono) via `@font-face` — required by `font-src 'self'` (no Google Fonts CDN).
- **App-local component layer** (`apps/app/app/components/`): thin, Tailwind-classed, prop-thin primitives (Button, Input/Textarea/Select, Card, Badge, PageShell, AppHeader, EmptyState; dashboard-specific StatusBadge/FolderTree extracted alongside the dashboard restyle). A shared `packages/ui` is **deferred** — only one consumer today (`apps/view` serves untrusted HTML and intentionally shares no chrome).
- **Clerk theming** via the `appearance` API on `ClerkApp` (Clerk renders its own DOM). Appearance `variables` use **hex literals mirroring the tokens** (not `var()`) — Clerk computes shades from the literal and CSS-var resolution inside its injected styles is unreliable.
- **Biome**: enable `css.parser.tailwindDirectives` so `biome ci` accepts Tailwind v4 at-rules (`@import "tailwindcss"`, `@theme`, `@custom-variant`).

## Consequences

- **Positive**: one-file re-theme; CSP/Trusted-Types-safe (static CSS, self-hosted fonts, no runtime CSS-in-JS) so it doesn't block the app-wide CSP work (#65); fast to build a polished, consistent UI; no runtime UI deps.
- **Negative / trade-offs**: Tailwind utility classes live in JSX (familiar churn); two woff2 binaries committed to the repo; Clerk appearance hexes duplicate the token values (acceptable, low-churn).
- **Scope**: light theme only for now (dark seam ships ready, not activated); no public marketing page; `apps/view` unchanged.

## More information

- Wiring: `@tailwindcss/vite` is the first Vite plugin in `apps/app/vite.config.ts`; the CSS entry `apps/app/app/tailwind.css` (`@import "tailwindcss"` + fonts + theme) is loaded via a `links()` export in `root.tsx` (`?url` import → `<Links/>`).
- Verified: `pnpm --filter arp-app build` compiles (Tailwind v4 + Remix v2 Vite + Vercel preset), `biome ci` green on the CSS (with `tailwindDirectives`), typecheck green.
