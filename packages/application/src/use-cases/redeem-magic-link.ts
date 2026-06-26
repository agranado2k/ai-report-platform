// redeemMagicLink — consume an allowlist magic link, create a revocable grant, and
// return what the route needs to mint the access token (ADR-0056, revocation-C). The
// nonce is single-use (NonceStore.take = GETDEL). Re-validates the allowlist at redeem
// time — the owner may have removed the email since the link was sent.
import {
  type AppError,
  err,
  notAllowed,
  notFound,
  ok,
  type Result,
  type Slug,
  verifyMagicLinkToken,
} from "arp-domain";
import type { Clock, GrantStore, NonceStore, ReportRepository } from "../ports";

export interface RedeemMagicLinkDeps {
  readonly reports: ReportRepository;
  readonly nonces: NonceStore;
  readonly grants: GrantStore;
  readonly clock: Clock;
}

export interface RedeemMagicLinkInput {
  readonly slug: Slug;
  readonly token: string;
  readonly secret: string;
}

export interface RedeemedGrant {
  readonly slug: Slug;
  readonly email: string;
  readonly accessTtlSeconds: number;
}

export async function redeemMagicLink(
  deps: RedeemMagicLinkDeps,
  input: RedeemMagicLinkInput,
): Promise<Result<RedeemedGrant, AppError>> {
  const nonceId = verifyMagicLinkToken(input.token, input.secret);
  if (!nonceId) return err(notAllowed("invalid or expired link"));

  const taken = await deps.nonces.take(nonceId); // single-use (GETDEL)
  if (!taken.ok) return taken;
  if (taken.value === null) return err(notAllowed("this link has already been used or expired"));

  let payload: { slug?: unknown; email?: unknown };
  try {
    payload = JSON.parse(taken.value);
  } catch {
    return err(notAllowed("invalid link"));
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  // Bind the link to the report it was issued for.
  if (payload.slug !== input.slug || !email)
    return err(notAllowed("link does not match this report"));

  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  const report = found.value;
  if (!report || report.deletedAt !== null || report.acl.mode !== "allowlist") {
    return err(notFound("report not found"));
  }
  // Re-validate the allowlist now (the owner may have removed the email since send).
  if (!report.acl.allowedEmails.includes(email)) return err(notAllowed("no longer permitted"));

  const expiresAtMs = deps.clock.now() + report.acl.accessTtlSeconds * 1000;
  const granted = await deps.grants.grant(report.id, email, expiresAtMs);
  if (!granted.ok) return granted;

  return ok({ slug: input.slug, email, accessTtlSeconds: report.acl.accessTtlSeconds });
}
