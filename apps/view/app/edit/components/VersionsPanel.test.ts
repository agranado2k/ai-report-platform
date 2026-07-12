// versionAuthorLabel (ADR-0063 author display): render the uploader's resolved
// email, falling back to a stable label — never the raw user_… id.
import { describe, expect, it } from "vitest";
import type { VersionWire } from "../wire-types";
import { versionAuthorLabel } from "./VersionsPanel";

const base: VersionWire = {
  object: "version",
  id: "version_1",
  version_no: 2,
  uploaded_by: "user_5mK9pQ2vR4nXtB6cD8eF1g",
  uploaded_at: "2026-07-08T00:00:00.000Z",
  scan_status: "clean",
  size_bytes: 1234,
  origin: "upload",
  mode: "prod",
};

describe("versionAuthorLabel", () => {
  it("shows the uploader's email when resolved", () => {
    expect(
      versionAuthorLabel({ ...base, author: { id: base.uploaded_by, email: "bob@example.com" } }),
    ).toBe("bob@example.com");
  });

  it("falls back to 'Unknown user' when the email is null", () => {
    expect(versionAuthorLabel({ ...base, author: { id: base.uploaded_by, email: null } })).toBe(
      "Unknown user",
    );
  });

  it("falls back to 'Unknown user' when the author field is absent (never the raw id)", () => {
    const label = versionAuthorLabel(base);
    expect(label).toBe("Unknown user");
    expect(label).not.toContain("user_");
  });
});
