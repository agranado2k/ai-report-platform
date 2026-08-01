import { describe, expect, it } from "vitest";
import { scopesFromForm } from "./api-key-scopes.server";

describe("scopesFromForm", () => {
  it("collects repeated `scopes` checkbox entries in submission order", () => {
    const form = new FormData();
    form.append("intent", "create");
    form.append("name", "sharing-agent");
    form.append("scopes", "reports:write");
    form.append("scopes", "acl:write");
    expect(scopesFromForm(form)).toEqual(["reports:write", "acl:write"]);
  });

  it("returns an empty list when no box is checked (the use case turns this into a 422)", () => {
    const form = new FormData();
    form.append("name", "none");
    expect(scopesFromForm(form)).toEqual([]);
  });

  it("passes values through verbatim — tampered values are NOT filtered here, the use case rejects them", () => {
    const form = new FormData();
    form.append("scopes", "reports:admin");
    expect(scopesFromForm(form)).toEqual(["reports:admin"]);
  });
});
