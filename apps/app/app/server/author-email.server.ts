// Shared author-email batch resolver (ADR-0063 author display). Both the
// version-history and comments Bearer list routes surface the responsible
// user's identity next to each item — the only stored, resolvable identity
// attribute is the email (there is NO display-name), via
// IdentityStore.findEmailByUserId (packages/application/src/ports.ts).
//
// The routes dedupe their page down to the UNIQUE author ids first
// (uniqueVersionAuthorIds / uniqueCommentAuthorIds), then hand them here so
// there is exactly ONE findEmailByUserId round-trip per distinct author, not
// one per row. Lookups run in parallel; a miss (deleted / never-mirrored user)
// OR an infra error both degrade to `null` for that id — author display is
// never essential enough to fail an already-authorized list read over. The id
// stays keyed in the returned map so the wire mapper can still emit the
// `user_…` External Id alongside a null email.
import type { IdentityStore } from "arp-application";
import type { UserId } from "arp-domain";

export async function resolveAuthorEmails(
  ids: readonly UserId[],
  identities: Pick<IdentityStore, "findEmailByUserId">,
): Promise<ReadonlyMap<UserId, string | null>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const result = await identities.findEmailByUserId(id);
      return [id, result.ok ? result.value : null] as const;
    }),
  );
  return new Map(entries);
}
