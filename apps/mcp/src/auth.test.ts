import { describe, expect, it, vi } from "vitest";
import { resolveDownstreamAuthorization } from "./auth";

describe("resolveDownstreamAuthorization", () => {
  it("forwards an arp_ API key verbatim (headless path) without touching OAuth", async () => {
    const verifyOAuthUser = vi.fn();
    const out = await resolveDownstreamAuthorization("Bearer arp_live_abc", { verifyOAuthUser });
    expect(out).toBe("Bearer arp_live_abc");
    expect(verifyOAuthUser).not.toHaveBeenCalled();
  });

  it("matches the Bearer scheme case-insensitively for the arp_ path", async () => {
    const verifyOAuthUser = vi.fn();
    const out = await resolveDownstreamAuthorization("bearer arp_live_abc", { verifyOAuthUser });
    expect(out).toBe("bearer arp_live_abc");
    expect(verifyOAuthUser).not.toHaveBeenCalled();
  });

  it("verifies an OAuth token then FORWARDS that same token (no session-token mint)", async () => {
    const verifyOAuthUser = vi.fn(async () => "user_123");
    const out = await resolveDownstreamAuthorization("Bearer eyJ_oauth_token", { verifyOAuthUser });
    // The verified OAuth token is forwarded verbatim — /api/v1 re-verifies it.
    expect(out).toBe("Bearer eyJ_oauth_token");
    expect(verifyOAuthUser).toHaveBeenCalledWith("Bearer eyJ_oauth_token");
  });

  it("returns null when the OAuth token doesn't verify", async () => {
    const out = await resolveDownstreamAuthorization("Bearer eyJ_bad", {
      verifyOAuthUser: async () => null,
    });
    expect(out).toBeNull();
  });

  it("returns null when no Authorization is present", async () => {
    const out = await resolveDownstreamAuthorization(null, {
      verifyOAuthUser: async () => "u",
    });
    expect(out).toBeNull();
  });
});
