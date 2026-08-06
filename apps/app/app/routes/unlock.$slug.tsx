// GET/POST app.<domain>/unlock/{slug} — authorize a private report (ADR-0056) and
// mint the view access token. The app holds the secret + the argon2id hash (and,
// for org mode, the Clerk session); the credential-free view origin only verifies
// the token it mints here. P1 implements `password`; P2 adds `org` (same-org
// session → redirect handshake, no form); P3 adds `allowlist` (email → one-time
// magic link → revocable grant).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { getReportAcl, redeemMagicLink, sendMagicLink } from "arp-application";
import { makeSlug, mintAccessToken, type Report, type Slug } from "arp-domain";
import { getAuth, resolveActorForRead } from "../server/auth.server";
import {
  accessTokenSecret,
  appOrigin,
  clock,
  deps,
  emailSender,
  grantStore,
  identityStore,
  nonceStore,
  orgWriteGrantStore,
  passwordHasher,
  viewOrigin,
  writeGrantStore,
} from "../server/container.server";
import { decidePrivateUnlock } from "../server/private-unlock.server";

const ACCESS_TTL_SECONDS = 900; // 15 min (password + org modes)

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

// THE ONE DENIAL. Every visitor this page will not open a report for — in ANY
// sharing mode, on GET and on POST — gets exactly these bytes and exactly this
// status.
//
// It is a 404, not a 403 (operator decision, 2026-08-06). A 403 reading "this
// report is private — only its owner can view it" still CONFIRMS that a report
// exists at this slug, which is the oracle the uniformity is supposed to close;
// it just moves the leak from the status line into the copy. `private` is the
// DEFAULT mode (ADR-0056), so an existence oracle here covers essentially every
// report on the platform. The only answer that leaks nothing is the one a
// never-created slug would get.
//
// So the wording is deliberately neutral — it presupposes no report, names no
// sharing mode, and is equally true for a slug that was never minted, a
// soft-deleted report, a private report belonging to someone else, and an `org`
// report belonging to another organization. The sign-in hint is the one
// affordance kept, because it is the same sentence for all of them and
// therefore distinguishes none of them.
const denied = () =>
  notice(
    "No report is available at this address. If you believe you should have access, sign in with the account it was shared with and try again.",
    404,
  );

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
  const found = await getReportAcl({ reports: deps().reports }, { slug });
  return found.ok ? found.value : null;
}

export async function loader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return denied();
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return denied();

  if (report.acl.mode === "public") {
    return redirectToView(slug.value, undefined, request); // nothing to authorize
  }
  // private = owner-only. This page USED TO assert that an owner never lands
  // here ("they reach it via the dashboard's owner-open") and 403 everyone
  // unconditionally. That was false in two ways, and the second one locked a
  // real owner out of their own report on 2026-08-06:
  //   1. the raw `view.<domain>/{slug}` link an owner naturally copies and
  //      shares lands exactly here, via the viewer's unlock hand-off; and
  //   2. ANY failure of the edit-token round-trip on the view origin degrades
  //      to the public viewer, which sends a private report straight here.
  // Unlike the credential-free view origin, this app HOLDS the Clerk session,
  // so it CAN resolve the actor. It asks the same canWrite question
  // `/reports/{slug}/open` asks (ADR-0059 §4 / ADR-0060 §4) and hands anyone it
  // admits a link to that ONE mint — no capability is minted or duplicated
  // here. Everyone else gets `denied()` — the SAME status and the SAME
  // bytes this route returns for a malformed slug, an unknown slug and a
  // soft-deleted report, so "not entitled", "not signed in" and "no such
  // report" are genuinely indistinguishable from outside.
  if (report.acl.mode === "private") {
    return privateUnlock(args, slug.value);
  }
  if (report.acl.mode === "password") return passwordForm(slug.value);
  if (report.acl.mode === "allowlist") return allowlistLoader(slug.value, request);
  if (report.acl.mode === "org") return orgUnlock(report, args);
  // Unreachable today — every AclMode (private/public/password/allowlist/org) is
  // handled above; kept as a defensive fallback for a future mode landing here
  // before its branch does.
  return notice("This sharing mode isn’t available yet.");
}

// `private` mode: ask decidePrivateUnlock (../server/private-unlock.server.ts)
// whether this session may write the report, and offer an entitled visitor the
// ONE owner-open route. Anonymous visitors are denied exactly like non-owners
// — NOT bounced to sign-in: a sign-in prompt for one slug and a flat 404 for
// another would turn this page into an existence oracle for private reports.
async function privateUnlock(args: LoaderFunctionArgs, slug: Slug): Promise<Response> {
  // `resolveActorForRead` passes this route's own `:slug`, so door 4 (the
  // slug-bound edit token, resolve-actor.server.ts) is live here — DELIBERATELY:
  // a caller holding a valid edit token for THIS report has already passed the
  // same canWrite gate `/reports/{slug}/open` runs, so admitting them adds no
  // capability they don't already hold.
  const actor = await resolveActorForRead(args);
  const decision = await decidePrivateUnlock(
    {
      reports: deps().reports,
      writeGrant: {
        grants: writeGrantStore(),
        orgWriteGrants: orgWriteGrantStore(),
        identities: identityStore(),
      },
    },
    { actor: actor.ok ? actor.value : null, slug },
  );
  if (decision.kind === "deny") return denied();
  return ownerOpenPage(decision.to);
}

// A one-click way back in, NOT an automatic redirect (see private-unlock.server.ts:
// /unlock is reached BY a redirect from the viewer and the viewer can bounce
// straight back here, so an auto-redirect could loop where today it terminates).
// `to` is built from a validated slug by decidePrivateUnlock — never raw input.
// The wording is deliberately role-NEUTRAL: `decidePrivateUnlock` admits every
// canWrite visitor, which is the owner OR a write-grantee (ADR-0060 §4), and a
// grantee reading "Open as owner" would be told they are something they aren't.
const ownerOpenPage = (to: string): Response =>
  html(
    `<h1>This report is private</h1>
<p>You have access to it. Open it below.</p>
<p><a href="${escapeAttr(to)}">Open this report</a></p>`,
  );

// `org` mode (ADR-0056 P2): no form — a redirect handshake. Anonymous → /sign-in
// (preserving the return URL, same convention as root.tsx's app-wide gate and
// reports.$slug.open.tsx). That bounce is NOT a denial — it is the sign-in this
// mode requires before it can decide anything, and it happens for every `org`
// slug alike, so it distinguishes none of them. Signed in but the session's org
// isn't the report's org → `denied()`, the same 404 as every other denial. Same
// org → mint the mode-bound ~15-min access token, like `password`, and redirect
// to the viewer.
async function orgUnlock(report: Report, args: LoaderFunctionArgs): Promise<Response> {
  const { userId: clerkUserId, orgId: clerkOrgId } = await getAuth(args);
  if (!clerkUserId) return signInRedirect(args.request);
  if (!clerkOrgId) return denied();

  // Membership is asserted by the Clerk-VERIFIED session org — we only map it
  // to our internal OrgId. Do NOT require a mirrored users row here: that row
  // is created on the write path, so demanding it would deny genuine members
  // who have only ever viewed (review #150 H-1).
  const memberOrg = await identityStore().findOrgByClerkOrgId(clerkOrgId);
  if (!memberOrg.ok) return notice("Something went wrong — try again.", 500);
  if (!memberOrg.value || memberOrg.value !== report.orgId) return denied();

  const secret = accessTokenSecret();
  if (!secret) return notice("Private viewing is not configured.");

  const token = mintAccessToken(
    report.slug,
    ACCESS_TTL_SECONDS,
    secret,
    Math.floor(Date.now() / 1000),
    { mode: "org" },
  );
  return redirectToView(report.slug, token, args.request);
}

// The `org`-mode non-member notice USED TO live here: `403 "You need to be a
// member of this report's organization to view it."` It was removed on
// 2026-08-06 in favour of `denied()`, because that sentence is itself an
// existence oracle — it confirms both that a report exists at this slug AND
// that it is shared in `org` mode, to any signed-in stranger who guesses a
// slug. ADR-0068 §1 gives a user exactly ONE org (keyed by their email domain),
// so the copy could never have said anything actionable anyway: there is no
// "switch your active organization and retry" under that model, and a member of
// the wrong org has no route to the right one. Losing it costs a genuine
// mistyped-slug visitor nothing they could have acted on, and closes the leak.

// Preserve the intended destination via `redirect_url`, which Clerk's <SignIn>
// honours post-auth (same convention as root.tsx's app-wide gate).
function signInRedirect(request: Request): Response {
  const { pathname, search } = new URL(request.url);
  return new Response(null, {
    status: 303,
    headers: {
      location: `/sign-in?redirect_url=${encodeURIComponent(pathname + search)}`,
      "cache-control": "no-store",
    },
  });
}

// Allowlist GET: a `?link=` query shows the confirm interstitial (redemption is POST-only, so
// an email scanner's prefetch can't consume the nonce); otherwise show the email form.
function allowlistLoader(slug: Slug, request: Request): Response {
  const link = new URL(request.url).searchParams.get("link");
  return link ? confirmLinkPage(slug, link) : allowlistForm(slug);
}

export async function action({ params, request }: ActionFunctionArgs) {
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return denied();
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return denied();
  // The POST side is the SAME oracle as the loader's: a `private` report has no
  // form to submit, so without this it fell through to "this sharing mode isn't
  // available yet" (200) while an unknown slug answered "Report not found."
  // (200) — two distinguishable answers reachable without ever issuing a GET.
  if (report.acl.mode === "private") return denied();

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
      {
        mode: "password",
      },
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
        { mode: "allowlist", email: redeemed.value.email },
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
