import { describe, expect, it } from "vitest";
import { mintMagicLinkToken, verifyMagicLinkToken } from "./magic-link";

const SECRET = "magic-link-hmac-secret";
const NONCE = "9f1c8a3e-1234-4abc-9def-0123456789ab";

describe("magic-link token (ADR-0056)", () => {
  it("round-trips the nonce id", () => {
    const token = mintMagicLinkToken(NONCE, SECRET);
    expect(verifyMagicLinkToken(token, SECRET)).toBe(NONCE);
  });

  it("rejects a token signed with a different secret", () => {
    const token = mintMagicLinkToken(NONCE, SECRET);
    expect(verifyMagicLinkToken(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload (nonce swapped, old signature)", () => {
    const sig = mintMagicLinkToken(NONCE, SECRET).split(".")[1];
    const forgedPayload = mintMagicLinkToken("00000000-0000-4000-8000-000000000000", SECRET).split(
      ".",
    )[0];
    expect(verifyMagicLinkToken(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyMagicLinkToken("garbage", SECRET)).toBeNull();
    expect(verifyMagicLinkToken("", SECRET)).toBeNull();
    expect(verifyMagicLinkToken(".sig", SECRET)).toBeNull();
  });
});
