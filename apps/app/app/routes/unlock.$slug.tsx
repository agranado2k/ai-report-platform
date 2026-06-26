// GET/POST app.<domain>/unlock/{slug} — authorize a private report (ADR-0056) and
// mint the view access token. The app holds the secret + the argon2id hash; the
// credential-free view origin only verifies the token it mints here. P1 implements
// `password`; P3 adds `allowlist` (email → one-time magic link → revocable grant).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redeemMagicLink, sendMagicLink } from "arp-application";
import { makeSlug, mintAccessToken, type Slug } from "arp-domain";
import {
  accessTokenSecret,
  appOrigin,
  clock,
  deps,
  emailSender,
  grantStore,
  nonceStore,
  passwordHasher,
  viewOrigin,
} from "../server/container.server";

const ACCESS_TTL_SECONDS = 900; // 15 min (password mode)

// `slug` is always a validated nanoid (makeSlug) before it reaches here, so it's safe
// to interpolate into the form action; no inline styles (the app-origin CSP, ADR-013/#65,
// may forbid them) — plain, functional HTML (claude-review #100).
// HTML-attribute escape — the `?link=` token is echoed into a hidden input on the confirm
// page, so an attacker-supplied `?link="><script>…` must not break out (claude-review #116).
const escapeAttr = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

// These raw Responses bypass entry.server.tsx, so set baseline framing headers here — the
// credential/email forms must not be frameable (clickjacking, claude-review #116). No inline
// styles (the app-origin CSP, ADR-013/#65, may forbid them) — plain, functional HTML.
function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Report access</title></head>
<body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
      },
    },
  );
}

const notice = (msg: string, status = 200) => html(`<h1>Not available</h1><p>${msg}</p>`, status);

function passwordForm(slug: string, opts: { error?: boolean } = {}): Response {
  return html(
    `<h1>This report is password-protected</h1>
<form method="post" action="/unlock/${slug}">
<p><label>Password<br /><input type="password" name="password" autofocus required /></label></p>
${opts.error ? `<p>Incorrect password — try again.</p>` : ""}
<p><button type="submit">View report</button></p>
</form>`,
    opts.error ? 401 : 200,
  );
}

function allowlistForm(slug: string, opts: { error?: string } = {}): Response {
  return html(
    `<h1>This report is private</h1>
<p>Enter your email. If you've been given access, we'll send you a one-time link.</p>
<form method="post" action="/unlock/${slug}">
<p><label>Email<br /><input type="email" name="email" autofocus required /></label></p>
${opts.error ? `<p>${opts.error}</p>` : ""}
<p><button type="submit">Email me a link</button></p>
</form>`,
    opts.error ? 401 : 200,
  );
}

const linkSentPage = () =>
  html(
    `<h1>Check your email</h1>
<p>If your email is on the access list for this report, we've sent a one-time link. It expires in 15 minutes.</p>`,
  );

// Confirm interstitial — the magic-link GET lands here; the actual redemption happens only
// when the user submits this form (POST), so email scanners' unsolicited GETs can't burn the
// one-time link (claude-review #116). The token is escaped into the hidden field.
function confirmLinkPage(slug: string, token: string): Response {
  return html(
    `<h1>View this report</h1>
<p>You've been given access. Open it below — this link works once.</p>
<form method="post" action="/unlock/${slug}">
<input type="hidden" name="token" value="${escapeAttr(token)}" />
<p><button type="submit">View report</button></p>
</form>`,
  );
}

async function loadAcl(slug: Slug) {
  const found = await deps().reports.findBySlug(slug);
  return found.ok ? found.value : null;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return notice("Report not found.");
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return notice("Report not found.");

  if (report.acl.mode === "public") {
    return redirectToView(slug.value, undefined, request); // nothing to authorize
  }
  if (report.acl.mode === "password") return passwordForm(slug.value);
  if (report.acl.mode === "allowlist") return allowlistLoader(slug.value, request);
  return notice("This sharing mode isn’t available yet.");
}

// Allowlist GET: a `?link=` query shows the confirm interstitial (redemption is POST-only, so
// an email scanner's prefetch can't consume the nonce); otherwise show the email form.
function allowlistLoader(slug: Slug, request: Request): Response {
  const link = new URL(request.url).searchParams.get("link");
  return link ? confirmLinkPage(slug, link) : allowlistForm(slug);
}

export async function action({ params, request }: ActionFunctionArgs) {
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return notice("Report not found.");
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return notice("Report not found.");

  const secret = accessTokenSecret();
  if (!secret) return notice("Private viewing is not configured.");

  if (report.acl.mode === "password") {
    const form = await request.formData();
    const password = String(form.get("password") ?? "");
    const verified = await passwordHasher().verify(password, report.acl.passwordHash);
    if (!verified.ok || !verified.value) return passwordForm(slug.value, { error: true });
    const token = mintAccessToken(
      slug.value,
      ACCESS_TTL_SECONDS,
      secret,
      Math.floor(Date.now() / 1000),
    );
    return redirectToView(slug.value, token, request);
  }

  if (report.acl.mode === "allowlist") {
    const form = await request.formData();
    const token = form.get("token");

    // A `token` field = the confirm-page submission → redeem (POST-only, so a scanner's GET
    // can't consume the one-time nonce, claude-review #116).
    if (typeof token === "string" && token) {
      const nonces = nonceStore();
      if (!nonces) return notice("Private viewing is not configured.");
      const redeemed = await redeemMagicLink(
        { reports: deps().reports, nonces, grants: grantStore(), clock: clock() },
        { slug: slug.value, token, secret },
      );
      if (!redeemed.ok) {
        return allowlistForm(slug.value, {
          error: "That link is invalid or has expired — request a new one.",
        });
      }
      // TTL matches the grant; the email is carried in the token so the viewer can check
      // a live grant for it per request (revocation-C, ADR-0056).
      const accessToken = mintAccessToken(
        slug.value,
        redeemed.value.accessTtlSeconds,
        secret,
        Math.floor(Date.now() / 1000),
        redeemed.value.email,
      );
      return redirectToView(slug.value, accessToken, request);
    }

    // Otherwise the email form → send a magic link.
    const nonces = nonceStore();
    const email = emailSender();
    if (!nonces || !email) return notice("Private viewing is not configured.");
    const entered = String(form.get("email") ?? "");
    // Await the send for reliability — a serverless lambda may freeze before a fire-and-
    // forget promise flushes. sendMagicLink is privacy-preserving (only sends when the
    // address is actually allowlisted); we render the same generic page on ANY outcome,
    // logging an infra error server-side. The minor timing side-channel is accepted (#115).
    const sent = await sendMagicLink(
      { reports: deps().reports, nonces, email, ids: deps().ids },
      { slug: slug.value, email: entered, appOrigin: appOrigin(request), secret },
    );
    if (!sent.ok) console.error("unlock: sendMagicLink failed", sent.error);
    return linkSentPage();
  }

  return notice("This sharing mode isn’t available yet.");
}

function redirectToView(slug: string, token?: string, request?: Request): Response {
  const origin = request ? viewOrigin(request) : "";
  const query = token ? `?access=${encodeURIComponent(token)}` : "";
  return new Response(null, {
    status: 303,
    headers: { location: `${origin}/${slug}${query}`, "cache-control": "no-store" },
  });
}
