// Behavior tests for the shared author-email batch resolver (ADR-0063 author
// display): one findEmailByUserId round-trip per unique id, with a miss OR an
// infra error both degrading to a null email (author display never fails an
// already-authorized list read).
import type { AppError, Result, UserId } from "arp-domain";
import { err, ok, userId } from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthorEmails } from "./author-email.server";

const authorA = userId("11111111-1111-7111-8111-111111111111");
const authorB = userId("22222222-2222-7222-8222-222222222222");
const authorC = userId("33333333-3333-7333-8333-333333333333");

function fakeIdentities(responses: ReadonlyMap<UserId, Result<string | null, AppError>>) {
  return {
    findEmailByUserId: vi.fn(
      async (id: UserId): Promise<Result<string | null, AppError>> => responses.get(id) ?? ok(null),
    ),
  };
}

describe("resolveAuthorEmails", () => {
  it("resolves each id to its email, once per id", async () => {
    const identities = fakeIdentities(
      new Map([
        [authorA, ok("alice@example.com")],
        [authorB, ok("bob@example.com")],
      ]),
    );
    const map = await resolveAuthorEmails([authorA, authorB], identities);
    expect(map.get(authorA)).toBe("alice@example.com");
    expect(map.get(authorB)).toBe("bob@example.com");
    expect(identities.findEmailByUserId).toHaveBeenCalledTimes(2);
  });

  it("maps a resolved miss (null email) through as null", async () => {
    const identities = fakeIdentities(new Map([[authorA, ok(null)]]));
    const map = await resolveAuthorEmails([authorA], identities);
    expect(map.get(authorA)).toBeNull();
  });

  it("degrades an infra error to a null email rather than throwing", async () => {
    const identities = fakeIdentities(
      new Map<UserId, Result<string | null, AppError>>([
        [authorA, ok("alice@example.com")],
        [authorC, err({ kind: "Unexpected", message: "db down" })],
      ]),
    );
    const map = await resolveAuthorEmails([authorA, authorC], identities);
    expect(map.get(authorA)).toBe("alice@example.com");
    expect(map.get(authorC)).toBeNull();
  });

  it("returns an empty map for no ids, making no lookups", async () => {
    const identities = fakeIdentities(new Map());
    const map = await resolveAuthorEmails([], identities);
    expect(map.size).toBe(0);
    expect(identities.findEmailByUserId).not.toHaveBeenCalled();
  });
});
