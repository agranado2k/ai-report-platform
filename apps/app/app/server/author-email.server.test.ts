// Behavior tests for the shared author-identity batch resolver (ADR-0063 author
// display): one findAuthorIdentityByUserId round-trip per unique id, resolving
// name + email, with a miss OR an infra error both degrading to a null identity
// (author display never fails an already-authorized list read).
import type { AppError, Result, UserId } from "arp-domain";
import { err, ok, userId } from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthorIdentities } from "./author-email.server";

type Author = { readonly email: string; readonly displayName: string | null };

const authorA = userId("11111111-1111-7111-8111-111111111111");
const authorB = userId("22222222-2222-7222-8222-222222222222");
const authorC = userId("33333333-3333-7333-8333-333333333333");

function fakeIdentities(responses: ReadonlyMap<UserId, Result<Author | null, AppError>>) {
  return {
    findAuthorIdentityByUserId: vi.fn(
      async (id: UserId): Promise<Result<Author | null, AppError>> => responses.get(id) ?? ok(null),
    ),
  };
}

describe("resolveAuthorIdentities", () => {
  it("resolves each id to its { name, email }, once per id", async () => {
    const identities = fakeIdentities(
      new Map<UserId, Result<Author | null, AppError>>([
        [authorA, ok({ email: "alice@example.com", displayName: "Alice Ackerman" })],
        [authorB, ok({ email: "bob@example.com", displayName: null })],
      ]),
    );
    const map = await resolveAuthorIdentities([authorA, authorB], identities);
    expect(map.get(authorA)).toEqual({ email: "alice@example.com", name: "Alice Ackerman" });
    expect(map.get(authorB)).toEqual({ email: "bob@example.com", name: null });
    expect(identities.findAuthorIdentityByUserId).toHaveBeenCalledTimes(2);
  });

  it("maps a resolved miss (null identity) through as { email: null, name: null }", async () => {
    const identities = fakeIdentities(new Map([[authorA, ok(null)]]));
    const map = await resolveAuthorIdentities([authorA], identities);
    expect(map.get(authorA)).toEqual({ email: null, name: null });
  });

  it("degrades an infra error to a null identity rather than throwing", async () => {
    const identities = fakeIdentities(
      new Map<UserId, Result<Author | null, AppError>>([
        [authorA, ok({ email: "alice@example.com", displayName: "Alice" })],
        [authorC, err({ kind: "Unexpected", message: "db down" })],
      ]),
    );
    const map = await resolveAuthorIdentities([authorA, authorC], identities);
    expect(map.get(authorA)).toEqual({ email: "alice@example.com", name: "Alice" });
    expect(map.get(authorC)).toEqual({ email: null, name: null });
  });

  it("returns an empty map for no ids, making no lookups", async () => {
    const identities = fakeIdentities(new Map());
    const map = await resolveAuthorIdentities([], identities);
    expect(map.size).toBe(0);
    expect(identities.findAuthorIdentityByUserId).not.toHaveBeenCalled();
  });
});
