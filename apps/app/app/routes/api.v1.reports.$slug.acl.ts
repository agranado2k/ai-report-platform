// GET  /api/v1/reports/{slug}/acl — read a report's sharing Acl (ADR-0056), org-scoped.
// POST /api/v1/reports/{slug}/acl — set it. Thin transport adapter: resolve the actor
// (read → no provision; write → `acl:write`) → parse → run the use case → serialize via
// arp-http. The use cases own org-ownership authz + hash any password.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { getReport, setAcl } from "arp-application";
import { ACL_MODES, type AclMode, validationError } from "arp-domain";
import { errorToHttp, getAclToHttp, parseJsonBody, setAclToHttp } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, passwordHasher } from "../server/container.server";
import { toResponse, unauthenticated, wireContext } from "../server/http.server";
import { resolveReportSlug } from "../server/report-handle.server";

// GET — read the current acl. resolveActorForRead resolves the org WITHOUT provisioning;
// a report outside the actor's org reads as not-found/not-allowed (getReport owns authz).
export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // infra failure → 500
  if (!actor.value) return toResponse(unauthenticated()); // no session / no org → 401

  const slug = await resolveReportSlug(String(args.params.slug ?? ""), deps().reports);
  if (!slug.ok) return toResponse(errorToHttp(slug.error));

  const result = await getReport(
    { reports: deps().reports },
    { orgId: actor.value.orgId },
    { slug: slug.value },
  );
  return toResponse(getAclToHttp(result));
}

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) return toResponse(errorToHttp(actor.error)); // 401 / 500 per kind

  const slug = await resolveReportSlug(String(args.params.slug ?? ""), deps().reports);
  if (!slug.ok) return toResponse(errorToHttp(slug.error));

  const body = await parseJsonBody(args.request);
  if (!body.ok) return toResponse(errorToHttp(body.error));

  const rawMode = typeof body.value.mode === "string" ? body.value.mode : "";
  if (!ACL_MODES.includes(rawMode as AclMode)) {
    return toResponse(
      errorToHttp(validationError(`mode must be one of: ${ACL_MODES.join(", ")}`, "mode")),
    );
  }
  const password = typeof body.value.password === "string" ? body.value.password : undefined;
  const allowedEmails = Array.isArray(body.value.allowed_emails)
    ? body.value.allowed_emails.filter((e): e is string => typeof e === "string")
    : undefined;
  const accessTtlSeconds =
    typeof body.value.access_ttl_seconds === "number" ? body.value.access_ttl_seconds : undefined;

  const result = await setAcl(
    { reports: deps().reports, hasher: passwordHasher() },
    { orgId: actor.value.orgId, scopes: actor.value.scopes },
    { slug: slug.value, mode: rawMode as AclMode, password, allowedEmails, accessTtlSeconds },
  );
  return toResponse(setAclToHttp(result, wireContext()));
}
