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
function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Report access</title></head>
<body>${body}</body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
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

// Allowlist GET: a `?link=` query is a magic-link redemption; otherwise show the email form.
async function allowlistLoader(slug: Slug, request: Request): Promise<Response> {
  const link = new URL(request.url).searchParams.get("link");
  if (!link) return allowlistForm(slug);

  const secret = accessTokenSecret();
  const nonces = nonceStore();
  if (!secret || !nonces) return notice("Private viewing is not configured.");

  const redeemed = await redeemMagicLink(
    { reports: deps().reports, nonces, grants: grantStore(), clock: clock() },
    { slug, token: link, secret },
  );
  if (!redeemed.ok) {
    return allowlistForm(slug, {
      error: "That link is invalid or has expired — request a new one.",
    });
  }
  // The access token's TTL matches the grant the viewer will check per request (5d).
  const token = mintAccessToken(
    slug,
    redeemed.value.accessTtlSeconds,
    secret,
    Math.floor(Date.now() / 1000),
  );
  return redirectToView(slug, token, request);
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
    const nonces = nonceStore();
    const email = emailSender();
    if (!nonces || !email) return notice("Private viewing is not configured.");
    const form = await request.formData();
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
