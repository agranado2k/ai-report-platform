import { describe, expect, it, vi } from "vitest";
import { resolveDownstreamAuthorization } from "./auth";

describe("resolveDownstreamAuthorization", () => {
  it("forwards an arp_ API key verbatim (headless path) without touching OAuth", async () => {
    const verifyOAuthUser = vi.fn();
    const mintSessionToken = vi.fn();
    const out = await resolveDownstreamAuthorization("Bearer arp_live_abc", {
      verifyOAuthUser,
      mintSessionToken,
    });
    expect(out).toBe("Bearer arp_live_abc");
    expect(verifyOAuthUser).not.toHaveBeenCalled();
    expect(mintSessionToken).not.toHaveBeenCalled();
  });

  it("matches the Bearer scheme case-insensitively for the arp_ path", async () => {
    const verifyOAuthUser = vi.fn();
    const out = await resolveDownstreamAuthorization("bearer arp_live_abc", {
      verifyOAuthUser,
      mintSessionToken: vi.fn(),
    });
    expect(out).toBe("bearer arp_live_abc");
    expect(verifyOAuthUser).not.toHaveBeenCalled();
  });

  it("OAuth token → verify → mint a session token, and forwards THAT (never the OAuth token)", async () => {
    const out = await resolveDownstreamAuthorization("Bearer eyJ_oauth_token", {
      verifyOAuthUser: async () => "user_123",
      mintSessionToken: async (userId) => `jwt-for-${userId}`,
    });
    expect(out).toBe("Bearer jwt-for-user_123");
  });

  it("returns null when the OAuth token doesn't verify", async () => {
    const out = await resolveDownstreamAuthorization("Bearer eyJ_bad", {
      verifyOAuthUser: async () => null,
      mintSessionToken: async () => "unused",
    });
    expect(out).toBeNull();
  });

  it("returns null when no Authorization is present", async () => {
    const out = await resolveDownstreamAuthorization(null, {
      verifyOAuthUser: async () => "u",
      mintSessionToken: async () => "j",
    });
    expect(out).toBeNull();
  });
});
