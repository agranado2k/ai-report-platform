// GET/POST app.<domain>/unlock/{slug} — authorize a private report (ADR-0056) and
// mint the view access token. The app holds the secret + the argon2id hash; the
// credential-free view origin only verifies the token it mints here. P1 implements
// `password` mode; `org`/`allowlist` land in P2/P3 (shown as not-yet-available).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { makeSlug, mintAccessToken, type Slug } from "arp-domain";
import { accessTokenSecret, deps, passwordHasher, viewOrigin } from "../server/container.server";

const ACCESS_TTL_SECONDS = 900; // 15 min

// `slug` is always a validated nanoid (makeSlug) before it reaches here, so it's
// safe to interpolate into the form action; no inline styles (the app-origin CSP,
// ADR-013/#65, may forbid them) — plain, functional HTML (claude-review #100).
function page(slug: string, opts: { error?: boolean; message?: string } = {}): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Password required</title></head>
<body>
${
  opts.message
    ? `<h1>Not available</h1><p>${opts.message}</p>`
    : `<h1>This report is password-protected</h1>
<form method="post" action="/unlock/${slug}">
<p><label>Password<br /><input type="password" name="password" autofocus required /></label></p>
${opts.error ? `<p>Incorrect password — try again.</p>` : ""}
<p><button type="submit">View report</button></p>
</form>`
}
</body></html>`;
  return new Response(body, {
    status: opts.error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function loadAcl(slug: Slug) {
  const found = await deps().reports.findBySlug(slug);
  return found.ok ? found.value : null;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return page("", { message: "Report not found." });
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return page("", { message: "Report not found." });
  if (report.acl.mode === "public") {
    // Nothing to authorize — send them to the viewer.
    return redirectToView(slug.value, undefined, request);
  }
  if (report.acl.mode !== "password") {
    return page("", { message: "This sharing mode isn’t available yet." });
  }
  return page(slug.value);
}

export async function action({ params, request }: ActionFunctionArgs) {
  const slug = makeSlug(String(params.slug ?? ""));
  if (!slug.ok) return page("", { message: "Report not found." });
  const report = await loadAcl(slug.value);
  if (!report || report.deletedAt !== null) return page("", { message: "Report not found." });
  if (report.acl.mode !== "password") {
    return page("", { message: "This sharing mode isn’t available yet." });
  }

  const secret = accessTokenSecret();
  if (!secret) return page("", { message: "Private viewing is not configured." });

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const verified = await passwordHasher().verify(password, report.acl.passwordHash);
  if (!verified.ok || !verified.value) return page(slug.value, { error: true });

  const token = mintAccessToken(
    slug.value,
    ACCESS_TTL_SECONDS,
    secret,
    Math.floor(Date.now() / 1000),
  );
  return redirectToView(slug.value, token, request);
}

function redirectToView(slug: string, token?: string, request?: Request): Response {
  const origin = request ? viewOrigin(request) : "";
  const query = token ? `?access=${encodeURIComponent(token)}` : "";
  return new Response(null, {
    status: 303,
    headers: { location: `${origin}/${slug}${query}`, "cache-control": "no-store" },
  });
}
