// POST /api/v1/reports/{slug}/acl — set a report's sharing Acl (ADR-0056). Thin
// transport adapter: resolve the actor (must hold `acl:write`) → parse
// { mode, password?, allowed_emails? } → run setAcl → serialize via arp-http. The
// use case validates org ownership + the scope and hashes any password (argon2id).
import type { ActionFunctionArgs } from "@remix-run/node";
import { setAcl } from "arp-application";
import { ACL_MODES, type AclMode, validationError } from "arp-domain";
import { errorToHttp, parseJsonBody, setAclToHttp } from "arp-http";
import { resolveUploadActor } from "../server/auth.server";
import { deps, passwordHasher } from "../server/container.server";
import { toResponse, wireContext } from "../server/http.server";
import { resolveReportSlug } from "../server/report-handle.server";

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
