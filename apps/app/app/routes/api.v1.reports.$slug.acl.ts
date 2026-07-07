// GET  /api/v1/reports/{slug}/acl — read a report's sharing Acl (ADR-0056),
// OWNER-ONLY (ADR-0059 §3: allowlist emails + share config are the owner's
// business — org members see only list metadata).
// POST /api/v1/reports/{slug}/acl — set it (owner-only + `acl:write`).
// Thin transport adapter, built from the `handle()` combinator: resolve the
// actor (read → no provision; write → provisions) + the slug → parse → run the
// use case → serialize via arp-http. The use cases own the ownership authz +
// hash any password. (The public /unlock flow uses the separate, deliberately
// unauthenticated `getReportAcl` use case — NOT this route.)
import { getAcl, setAcl } from "arp-application";
import { ACL_MODES, type AclMode, err, validationError } from "arp-domain";
import { getAclToHttp, setAclToHttp } from "arp-http";
import { deps, grantStore, passwordHasher } from "../server/container.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";

// GET — read the current acl, owner-only (getAcl owns authz via the
// loadOwnedReport owner guard; a non-owner gets 403 NotAllowed).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) =>
    getAcl({ reports: deps().reports }, { orgId: actor.orgId, userId: actor.userId }, { slug }),
  toHttp: (result) => getAclToHttp(result),
});

export const action = handle({
  mode: "write",
  slug: true,
  parseBody: true,
  run: ({ actor, slug, body }) => {
    const rawMode = typeof body.mode === "string" ? body.mode : "";
    if (!ACL_MODES.includes(rawMode as AclMode)) {
      return err(validationError(`mode must be one of: ${ACL_MODES.join(", ")}`, "mode"));
    }
    const password = typeof body.password === "string" ? body.password : undefined;
    const allowedEmails = Array.isArray(body.allowed_emails)
      ? body.allowed_emails.filter((e): e is string => typeof e === "string")
      : undefined;
    const accessTtlSeconds =
      typeof body.access_ttl_seconds === "number" ? body.access_ttl_seconds : undefined;

    return setAcl(
      { reports: deps().reports, hasher: passwordHasher(), grants: grantStore() },
      { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
      { slug, mode: rawMode as AclMode, password, allowedEmails, accessTtlSeconds },
    );
  },
  toHttp: (result) => setAclToHttp(result, wireContext()),
});
