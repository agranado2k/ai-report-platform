// DELETE /api/v1/reports/{slug}/write-grants/{email} — revoke a write grant
// (ADR-0060). OWNER-ONLY + the `acl:write` scope (ADR-0016). The path email is
// URL-encoded by the client; Remix/React Router decodes route params before
// they reach `params.email`, and `revokeWrite` normalizes it via `EmailAddress`
// before the `(report_id, grantee_email)` lookup, so case/whitespace variants
// can't miss the row. Idempotent — revoking a non-existent grant still 204s.
import type { ActionFunctionArgs } from "@remix-run/node";
import { revokeWrite } from "arp-application";
import { methodNotAllowed } from "arp-domain";
import { errorToHttp, revokeWriteToHttp } from "arp-http";
import { auditLogger, deps, writeGrantStore } from "../server/container.server";
import { handle } from "../server/handle.server";
import { toResponse } from "../server/http.server";

export async function action(args: ActionFunctionArgs) {
  if (args.request.method.toUpperCase() !== "DELETE") {
    return toResponse(errorToHttp(methodNotAllowed("DELETE")));
  }
  return deleteHandler(args);
}

const deleteHandler = handle({
  mode: "write",
  slug: true,
  run: ({ actor, slug, args }) =>
    revokeWrite(
      { reports: deps().reports, grants: writeGrantStore(), audit: auditLogger(), uow: deps().uow },
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { slug, email: String(args.params.email ?? "") },
    ),
  toHttp: (result) => revokeWriteToHttp(result),
});
