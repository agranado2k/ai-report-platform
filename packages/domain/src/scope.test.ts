import { describe, expect, it } from "vitest";
import {
  ACL_WRITE_SCOPE,
  API_KEY_SCOPES,
  KEY_ISSUABLE_SCOPES,
  makeScopes,
  REPORTS_WRITE_SCOPE,
} from "./scope";

describe("Scope vocabulary (ADR-0016)", () => {
  it("API_KEY_SCOPES is exactly the four ADR-0016 scopes", () => {
    expect(API_KEY_SCOPES).toEqual(["reports:write", "reports:read", "folders:write", "acl:write"]);
  });

  it("KEY_ISSUABLE_SCOPES is the enforced subset the picker offers", () => {
    expect(KEY_ISSUABLE_SCOPES).toEqual(["reports:write", "acl:write"]);
  });

  it("the named constants match their wire strings", () => {
    expect(REPORTS_WRITE_SCOPE).toBe("reports:write");
    expect(ACL_WRITE_SCOPE).toBe("acl:write");
  });
});

describe("makeScopes", () => {
  it("accepts a subset of the allowed scopes, order-preserving", () => {
    const r = makeScopes(["reports:write", "acl:write"], KEY_ISSUABLE_SCOPES);
    expect(r.ok && r.value).toEqual(["reports:write", "acl:write"]);
  });

  it("dedupes repeated members (order-preserving on first occurrence)", () => {
    const r = makeScopes(["acl:write", "reports:write", "acl:write"], KEY_ISSUABLE_SCOPES);
    expect(r.ok && r.value).toEqual(["acl:write", "reports:write"]);
  });

  it("rejects an empty selection with a field-tagged ValidationError", () => {
    const r = makeScopes([], KEY_ISSUABLE_SCOPES);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    if (r.ok || r.error.kind !== "ValidationError") return;
    expect(r.error.field).toBe("scopes");
  });

  it("rejects an unknown scope, naming it in the message", () => {
    const r = makeScopes(["reports:write", "reports:admin"], KEY_ISSUABLE_SCOPES);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    if (r.ok || r.error.kind !== "ValidationError") return;
    expect(r.error.message).toContain("reports:admin");
    expect(r.error.field).toBe("scopes");
  });

  it("rejects a scope outside the allowed subset even when it exists in the full vocabulary", () => {
    // `reports:read` is a real ADR-0016 scope but NOT key-issuable (enforced nowhere).
    const r = makeScopes(["reports:read"], KEY_ISSUABLE_SCOPES);
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("accepts the full vocabulary against API_KEY_SCOPES", () => {
    const r = makeScopes([...API_KEY_SCOPES], API_KEY_SCOPES);
    expect(r.ok && r.value).toEqual(API_KEY_SCOPES);
  });
});
