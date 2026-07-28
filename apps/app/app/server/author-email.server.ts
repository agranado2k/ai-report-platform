// Shared author-identity batch resolver (ADR-0063 author display). Both the
// version-history and comments Bearer list routes surface the responsible user's
// identity next to each item — the human display name when one is stored, else
// the email — via IdentityStore.findAuthorIdentityByUserId
// (packages/application/src/ports.ts), which resolves email + display name in
// ONE query per author.
//
// The routes dedupe their page down to the UNIQUE author ids first
// (uniqueVersionAuthorIds / uniqueCommentAuthorIds), then hand them here so
// there is exactly ONE findAuthorIdentityByUserId round-trip per distinct
// author, not one per row. Lookups run in parallel; a miss (deleted /
// never-mirrored user) OR an infra error both degrade to `{ email: null, name:
// null }` for that id — author display is never essential enough to fail an
// already-authorized list read over. The id stays keyed in the returned map so
// the wire mapper can still emit the `user_…` External Id alongside a null
// identity.
import type { IdentityStore } from "arp-application";
import type { UserId } from "arp-domain";

/** A resolved author's display identity on the wire (ADR-0063): the human name
 *  when stored, plus the email fallback. Both may be null (unresolved). */
export interface ResolvedAuthor {
  readonly email: string | null;
  readonly name: string | null;
}

export async function resolveAuthorIdentities(
  ids: readonly UserId[],
  identities: Pick<IdentityStore, "findAuthorIdentityByUserId">,
): Promise<ReadonlyMap<UserId, ResolvedAuthor>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const result = await identities.findAuthorIdentityByUserId(id);
      const author: ResolvedAuthor =
        result.ok && result.value
          ? { email: result.value.email, name: result.value.displayName }
          : { email: null, name: null };
      return [id, author] as const;
    }),
  );
  return new Map(entries);
}
