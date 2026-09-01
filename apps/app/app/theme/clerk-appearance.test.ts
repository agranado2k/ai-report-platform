// Unit tests for the extracted Clerk `appearance` config (ADR-0086, ticket
// #324). Clerk renders its own DOM for sign-in / sign-up / the account menu and
// is themed through this pure value, so the value itself is what we pin.
//
// Two things matter and nothing else catches drift on them:
//   1. No dark baseTheme — light is Clerk's DEFAULT (there is no `light` export
//      in @clerk/themes; "light" is the absence of a base-theme override), and
//      omitting it restores Clerk's light COMPUTED neutrals (menu items, icons,
//      dividers). See ADR-0086's Clerk amendment.
//   2. The ClickUp light literals. Clerk can't resolve `var()`, so these
//      duplicate the ADR-0086 token values as hex. Pinning them here is a
//      CHANGE DETECTOR against the values ADR-0086 records — an edit to the
//      module without a matching edit here fails. It does NOT read theme.css,
//      so it cannot catch the shared tokens moving underneath it; a cross-file
//      guard (like the unlock page's, see unlock-route.test.ts) is a follow-up
//      once the #323 token re-theme lands and theme.css carries these values.
import { dark } from "@clerk/themes";
import { describe, expect, it } from "vitest";
import { clerkAppearance } from "./clerk-appearance";

describe("clerkAppearance (ADR-0086 ClickUp light)", () => {
  it("applies no dark baseTheme — light is Clerk's default", () => {
    expect(clerkAppearance.baseTheme).toBeUndefined();
    expect(clerkAppearance.baseTheme).not.toBe(dark);
  });

  it("pins the ClickUp light literals recorded in ADR-0086", () => {
    expect(clerkAppearance.variables).toEqual({
      colorPrimary: "#7B68EE",
      colorText: "#2A2E34",
      colorTextSecondary: "#656F7D",
      colorBackground: "#FFFFFF",
      colorInputBackground: "#F5F6F8",
      colorInputText: "#2A2E34",
      fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
      borderRadius: "12px",
    });
  });
});
