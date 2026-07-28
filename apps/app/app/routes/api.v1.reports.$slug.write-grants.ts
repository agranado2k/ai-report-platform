// GET  /api/v1/reports/{slug}/write-grants — list everyone with write access
// (ADR-0060). OWNER-ONLY + the `acl:write` scope (ADR-0016) — share config is
// the owner's business (mirrors GET /acl's ownership gate, ADR-0059 §3).
// POST /api/v1/reports/{slug}/write-grants — grant write (rename / re-upload /
// move) to a person by email. Same owner-only + `acl:write` gate.
// Thin transport adapter over the deepened `handle()` seam + `ops()`; the use
// cases own the ownership authz.
import { grantWriteToHttp, listWriteGrantsToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";

// GET — list, owner-only (listWriteGrants owns authz via the loadOwnedReport
// owner guard; a non-owner gets 403 NotAllowed, and a caller without the
// acl:write scope gets 403 InsufficientScope).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) =>
    ops().listWriteGrants(
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { slug },
    ),
  toHttp: (result) => listWriteGrantsToHttp(result),
});

export const action = methods({
  POST: handle({
    mode: "write",
    slug: true,
    parseBody: true,
    run: ({ actor, slug, body, idempotencyKey }) =>
      ops().grantWrite(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        { slug, email: typeof body.email === "string" ? body.email : "", idempotencyKey },
      ),
    toHttp: (result) => grantWriteToHttp(result),
  }),
});
