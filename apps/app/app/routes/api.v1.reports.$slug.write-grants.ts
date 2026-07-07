// GET  /api/v1/reports/{slug}/write-grants — list everyone with write access
// (ADR-0060). OWNER-ONLY + the `acl:write` scope (ADR-0016) — share config is
// the owner's business (mirrors GET /acl's ownership gate, ADR-0059 §3).
// POST /api/v1/reports/{slug}/write-grants — grant write (rename / re-upload /
// move) to a person by email. Same owner-only + `acl:write` gate.
// Thin transport adapter, built from the `handle()` combinator: resolve the
// actor (read → no provision; write → provisions) + the slug → parse → run
// the use case → serialize via arp-http. The use cases own the ownership authz.
import { grantWrite, listWriteGrants } from "arp-application";
import { grantWriteToHttp, listWriteGrantsToHttp } from "arp-http";
import { deps, identityStore, writeGrantStore } from "../server/container.server";
import { handle } from "../server/handle.server";

// GET — list, owner-only (listWriteGrants owns authz via the loadOwnedReport
// owner guard; a non-owner gets 403 NotAllowed, and a caller without the
// acl:write scope gets 403 InsufficientScope).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) =>
    listWriteGrants(
      { reports: deps().reports, grants: writeGrantStore() },
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { slug },
    ),
  toHttp: (result) => listWriteGrantsToHttp(result),
});

export const action = handle({
  mode: "write",
  slug: true,
  parseBody: true,
  run: ({ actor, slug, body }) => {
    const email = typeof body.email === "string" ? body.email : "";
    return grantWrite(
      { reports: deps().reports, grants: writeGrantStore(), identities: identityStore() },
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { slug, email },
    );
  },
  toHttp: (result) => grantWriteToHttp(result),
});
