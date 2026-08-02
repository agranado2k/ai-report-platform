// DELETE /api/v1/folders/{id}/shares/{email} — revoke a folder share
// (ADR-0076). OWNER-OR-LEGACY only + the `acl:write` scope. The path email is
// URL-encoded by the client; React Router decodes route params before they
// reach `params.email`, and `unshareFolder` normalizes it via `EmailAddress`
// before the `(folder_id, grantee_email)` lookup, so case/whitespace variants
// can't miss the row. Idempotent — unsharing a non-existent share still 204s,
// and a retried unshare replays its recorded 204 (ADR-0039). Mirrors
// DELETE /reports/{slug}/write-grants/{email} (ADR-0060).
import { makeFolderId } from "arp-domain";
import { unshareFolderToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";

export const action = methods({
  DELETE: handle({
    mode: "write",
    run: ({ args, actor, idempotencyKey }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      return ops().unshareFolder(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        { folderId: id.value, email: String(args.params.email ?? ""), idempotencyKey },
      );
    },
    toHttp: (result) => unshareFolderToHttp(result),
  }),
});
