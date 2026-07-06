// GET  /api/v1/reports/{slug}/acl — read a report's sharing Acl (ADR-0056), org-scoped.
// POST /api/v1/reports/{slug}/acl — set it. Thin transport adapter, built from the
// `handle()` combinator: resolve the actor (read → no provision; write → `acl:write`)
// + the slug → parse → run the use case → serialize via arp-http. The use cases own
// org-ownership authz + hash any password.
import { getReport, setAcl } from "arp-application";
import { ACL_MODES, type AclMode, err, validationError } from "arp-domain";
import { getAclToHttp, setAclToHttp } from "arp-http";
import { deps, passwordHasher } from "../server/container.server";
import { handle } from "../server/handle.server";
import { wireContext } from "../server/http.server";

// GET — read the current acl. resolveActorForRead resolves the org WITHOUT provisioning;
// a report outside the actor's org reads as not-found/not-allowed (getReport owns authz).
export const loader = handle({
  mode: "read",
  slug: true,
  run: ({ actor, slug }) =>
    getReport({ reports: deps().reports }, { orgId: actor.orgId }, { slug }),
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
      { reports: deps().reports, hasher: passwordHasher() },
      { orgId: actor.orgId, scopes: actor.scopes },
      { slug, mode: rawMode as AclMode, password, allowedEmails, accessTtlSeconds },
    );
  },
  toHttp: (result) => setAclToHttp(result, wireContext()),
});
