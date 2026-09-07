// Pure-logic tests for the Settings → API keys section (#338, report §04). No
// DOM: the scope catalogue, the created-key narrowing, action-error extraction,
// key status, and date formatting are plain functions so the presentational
// islands stay thin. Presentation is smoke-tested separately.
import { describe, expect, it } from "vitest";
import { actionError, createdKeyView, formatKeyDate, keyStatus, SCOPE_CARDS } from "./api-keys";

describe("SCOPE_CARDS", () => {
  it("catalogues exactly the two KEY_ISSUABLE_SCOPES (ADR-0016)", () => {
    expect(SCOPE_CARDS.map((s) => s.id)).toEqual(["reports:write", "acl:write"]);
  });
  it("defaults reports:write on and acl:write off (least privilege)", () => {
    expect(SCOPE_CARDS.find((s) => s.id === "reports:write")?.defaultChecked).toBe(true);
    expect(SCOPE_CARDS.find((s) => s.id === "acl:write")?.defaultChecked).toBe(false);
  });
  it("each card explains its grant", () => {
    for (const card of SCOPE_CARDS) {
      expect(card.title).toBeTruthy();
      expect(card.description.length).toBeGreaterThan(10);
    }
  });
});

describe("createdKeyView", () => {
  it("narrows a create-success action payload to the reveal view", () => {
    const view = createdKeyView({
      ok: true,
      secret: "arp_live_abc123",
      name: "Claude · laptop",
      scopes: ["reports:write"],
    });
    expect(view).toEqual({
      secret: "arp_live_abc123",
      name: "Claude · laptop",
      scopes: ["reports:write"],
    });
  });
  it("is null for a revoke success (no secret)", () => {
    expect(createdKeyView({ ok: true })).toBeNull();
  });
  it("is null for an explicit-key replay (secret present but null, ADR-0039)", () => {
    expect(createdKeyView({ ok: true, secret: null, name: "x", scopes: [] })).toBeNull();
  });
  it("is null for an error payload and for undefined", () => {
    expect(createdKeyView({ error: "boom" })).toBeNull();
    expect(createdKeyView(undefined)).toBeNull();
  });
});

describe("actionError", () => {
  it("extracts a non-empty error string", () => {
    expect(actionError({ error: "Unknown scope" })).toBe("Unknown scope");
  });
  it("is null when there is no error", () => {
    expect(actionError({ ok: true })).toBeNull();
    expect(actionError({ error: "" })).toBeNull();
    expect(actionError(undefined)).toBeNull();
  });
});

describe("keyStatus", () => {
  it("is revoked when revokedAt is set, active otherwise", () => {
    expect(keyStatus(1234)).toBe("revoked");
    expect(keyStatus(null)).toBe("active");
    expect(keyStatus(undefined)).toBe("active");
  });
});

describe("formatKeyDate", () => {
  it("renders a present timestamp as a locale date", () => {
    expect(formatKeyDate(Date.UTC(2026, 7, 12))).toMatch(/\d/);
  });
  it("renders an em dash for a missing timestamp", () => {
    expect(formatKeyDate(null)).toBe("—");
    expect(formatKeyDate(undefined)).toBe("—");
  });
});
