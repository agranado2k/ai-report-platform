// GET/POST app.<domain>/unlock/{slug} — authorize a private report (ADR-0056) and
// mint the view access token. The app holds the secret + the argon2id hash; the
// credential-free view origin only verifies the token it mints here. P1 implements
// `password` mode; `org`/`allowlist` land in P2/P3 (shown as not-yet-available).
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { mintAccessToken } from "arp-domain";
import { accessTokenSecret, deps, passwordHasher, viewOrigin } from "../server/container.server";

const ACCESS_TTL_SECONDS = 900; // 15 min

function page(slug: string, opts: { error?: boolean; message?: string } = {}): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Password required</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem">
${
  opts.message
    ? `<h1>Not available</h1><p>${opts.message}</p>`
    : `<h1>This report is password-protected</h1>
<form method="post" action="/unlock/${slug}">
<p><label>Password<br /><input type="password" name="password" autofocus required /></label></p>
${opts.error ? `<p style="color:#b00">Incorrect password — try again.</p>` : ""}
<p><button type="submit">View report</button></p>
</form>`
}
</body></html>`;
  return new Response(body, {
    status: opts.error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function loadAcl(slugStr: string) {
  const found = await deps().reports.findBySlug(slugStr as never);
  return found.ok ? found.value : null;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = String(params.slug ?? "");
  const report = await loadAcl(slug);
  if (!report || report.deletedAt !== null) return page(slug, { message: "Report not found." });
  if (report.acl.mode === "public") {
    // Nothing to authorize — send them to the viewer.
    return redirectToView(slug, undefined, request);
  }
  if (report.acl.mode !== "password") {
    return page(slug, { message: "This sharing mode isn’t available yet." });
  }
  return page(slug);
}

export async function action({ params, request }: ActionFunctionArgs) {
  const slug = String(params.slug ?? "");
  const report = await loadAcl(slug);
  if (!report || report.deletedAt !== null) return page(slug, { message: "Report not found." });
  if (report.acl.mode !== "password") {
    return page(slug, { message: "This sharing mode isn’t available yet." });
  }

  const secret = accessTokenSecret();
  if (!secret) return page(slug, { message: "Private viewing is not configured." });

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const verified = await passwordHasher().verify(password, report.acl.passwordHash);
  if (!verified.ok || !verified.value) return page(slug, { error: true });

  const token = mintAccessToken(slug, ACCESS_TTL_SECONDS, secret, Math.floor(Date.now() / 1000));
  return redirectToView(slug, token, request);
}

function redirectToView(slug: string, token?: string, request?: Request): Response {
  const origin = request ? viewOrigin(request) : "";
  const query = token ? `?access=${encodeURIComponent(token)}` : "";
  return new Response(null, {
    status: 303,
    headers: { location: `${origin}/${slug}${query}`, "cache-control": "no-store" },
  });
}
