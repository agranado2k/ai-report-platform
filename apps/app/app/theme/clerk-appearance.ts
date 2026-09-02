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
// is a standing drift risk: the unit test pins these against the ADR's recorded
// values (a change detector), not against the shared theme.css — keep them in
// lockstep with theme.css by hand until a cross-file guard exists.
export const clerkAppearance = {
  // No `baseTheme` key at all — that IS Clerk's light default (ADR-0086's Clerk
  // amendment prescribes omitting it). The unit test pins the key as absent.
  // When dark returns as the deferred `.dark {}` follow-up, note that the
  // installed @clerk/shared types mark `baseTheme` deprecated in favour of
  // `theme`.
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
