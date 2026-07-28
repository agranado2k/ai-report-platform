import { err, notAllowed, ok } from "arp-domain";
import { describe, expect, it } from "vitest";
import { refreshEditTokenToHttp } from "./edit-token-response";

describe("refreshEditTokenToHttp", () => {
  it("renders a 200 edit_token resource with the wire-shaped fields", () => {
    const http = refreshEditTokenToHttp(
      ok({ editToken: "opaque.token.value", expiresAt: 1_750_000_900 }),
    );

    expect(http.status).toBe(200);
    expect(http.contentType).toBe("application/json");
    expect(http.body).toEqual({
      object: "edit_token",
      edit_token: "opaque.token.value",
      expires_at: 1_750_000_900,
    });
  });

  it("renders the problem+json error on a denied refresh (e.g. revoked canWrite)", () => {
    const http = refreshEditTokenToHttp(err(notAllowed("not allowed")));

    expect(http.status).toBe(403);
    expect(http.contentType).toBe("application/problem+json");
  });
});
