// Clerk `appearance` config, extracted from root.tsx so it can be unit-tested
// (ticket #324, ADR-0086). Clerk renders its own DOM for the sign-in / sign-up
// screens and the account (UserButton) menu; we theme all of it through this
// single pure value, imported by root.tsx and pinned by clerk-appearance.test.ts.
//
// LIGHT is Clerk's DEFAULT appearance. @clerk/themes ships no `light` export —
// only `dark` (and other opt-in bases) — so "light" is achieved by applying NO
// baseTheme at all. Omitting it (rather than the previous `baseTheme: dark`)
// restores Clerk's light COMPUTED neutrals — popover menu items, icons,
// dividers, secondary text — which the variable overrides below do not control.
// (ADR-0086 Clerk amendment.)
//
// The `variables` are the ClickUp light literals. Clerk needs literal hex here,
// not CSS `var()` (var() resolution inside its injected styles is unreliable),
// so these INTENTIONALLY duplicate the ADR-0086 token values. That duplication
// is the drift risk the unit test exists to catch — keep these in lockstep with
// the tokens in the shared theme.css.
export const clerkAppearance = {
  // No base-theme import: `baseTheme: undefined` is Clerk's light default and is
  // runtime-identical to omitting the key, while keeping the "no dark override"
  // decision explicit in code (and unit-pinnable — @clerk/themes has no `light`
  // to compare against).
  baseTheme: undefined,
  variables: {
    colorPrimary: "#7B68EE",
    colorText: "#2A2E34",
    colorTextSecondary: "#656F7D",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#F5F6F8",
    colorInputText: "#2A2E34",
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
    borderRadius: "12px",
  },
};
