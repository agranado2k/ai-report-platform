// DELETE /api/v1/reports/{slug}/write-grants/{email} — revoke a write grant
// (ADR-0060). OWNER-ONLY + the `acl:write` scope (ADR-0016). The path email is
// URL-encoded by the client; Remix/React Router decodes route params before
// they reach `params.email`, and `revokeWrite` normalizes it via `EmailAddress`
// before the `(report_id, grantee_email)` lookup, so case/whitespace variants
// can't miss the row. Idempotent — revoking a non-existent grant still 204s,
// and a retried revoke replays its recorded 204 (ADR-0039).
import { revokeWriteToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";

export const action = methods({
  DELETE: handle({
    mode: "write",
    slug: true,
    run: ({ actor, slug, args, idempotencyKey }) =>
      ops().revokeWrite(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        { slug, email: String(args.params.email ?? ""), idempotencyKey },
      ),
    toHttp: (result) => revokeWriteToHttp(result),
  }),
});
