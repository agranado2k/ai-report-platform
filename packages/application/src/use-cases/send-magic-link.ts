// sendMagicLink — issue an allowlist magic link (ADR-0056). PRIVACY: every non-sending
// path resolves ok without revealing whether the email is on the list; it only stores a
// nonce + sends when the address is actually allowlisted. CONTRACT for the route (5c): show
// the same generic "if your email is on the list, we've sent a link" on ANY outcome — an
// err means only an infra failure (nonce store / email send), which the route logs but does
// NOT surface (so a Resend outage can't be distinguished from "not on the list").
import { type AppError, mintMagicLinkToken, ok, type Result, type Slug } from "arp-domain";
import type { EmailSender, IdGenerator, NonceStore, ReportRepository } from "../ports";

const NONCE_TTL_SECONDS = 900; // 15-minute magic link

export interface SendMagicLinkDeps {
  readonly reports: ReportRepository;
  readonly nonces: NonceStore;
  readonly email: EmailSender;
  readonly ids: IdGenerator;
}

export interface SendMagicLinkInput {
  readonly slug: Slug;
  readonly email: string;
  /** App origin for the redeem link, e.g. `https://app.<apex>`. */
  readonly appOrigin: string;
  /** HMAC secret for the magic-link token. */
  readonly secret: string;
}

export async function sendMagicLink(
  deps: SendMagicLinkDeps,
  input: SendMagicLinkInput,
): Promise<Result<void, AppError>> {
  const email = input.email.trim().toLowerCase();

  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  const report = found.value;

  // No-op (privacy) for anything that isn't a live allowlist report with this email.
  if (!report || report.deletedAt !== null || report.acl.mode !== "allowlist") return ok(undefined);
  if (!report.acl.allowedEmails.includes(email)) return ok(undefined);

  const nonceId = deps.ids.nonceId();
  const stored = await deps.nonces.put(
    nonceId,
    JSON.stringify({ slug: input.slug, email }),
    NONCE_TTL_SECONDS,
  );
  if (!stored.ok) return stored;

  const token = mintMagicLinkToken(nonceId, input.secret);
  const url = `${input.appOrigin}/unlock/${input.slug}?link=${encodeURIComponent(token)}`;
  return deps.email.send({
    to: email,
    subject: "Your report access link",
    html: `<p>You've been given access to a report.</p><p><a href="${url}">View the report</a></p><p>This link works once and expires in 15 minutes.</p>`,
  });
}
