// The viewer — serves a report's LIVE (clean-scanned) version by slug at the
// canonical view.<domain>/<slug> path (ADR-002 origin isolation, ADR-0038). This
// is THE sandboxed view origin: untrusted report HTML is served here, never on
// the app origin, under the full ADR-013 security-header stack (viewHeaders).
// The ADR-0038 §2 gate is the shared, unit-tested resolveViewableReport.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { resolveAccessDecision, resolveViewableReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { viewHeaders } from "arp-headers/view";
import { viewerAccessConfig, viewerDeps } from "../server/container.server";
import { parseVersionQuery } from "../server/version-query";

// The unlock cookie (ADR-0056): a per-report capability the viewer issues to itself
// after verifying the app's `?access` hand-off — NOT an app/Clerk credential, so the
// ADR-002/0038 origin isolation holds. Path-scoped + the value is a slug-bound token,
// so it only unlocks its own report.
const UNLOCK_COOKIE = "arp_unlock";

function readUnlockCookie(request: Request): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === UNLOCK_COOKIE) return rest.join("=") || undefined;
  }
  return undefined;
}

// Max-Age = the token's remaining life (= the grant's TTL for allowlist, ~15 min for
// password), so a long-lived allowlist grant isn't re-prompted every 15 min. Revocation
// stays immediate via the per-request grant check, not via a short cookie (ADR-0056).
function unlockCookie(slug: string, token: string, maxAgeSeconds: number): string {
  // HttpOnly + Secure + SameSite=Lax; path-scoped to this report only.
  return `${UNLOCK_COOKIE}=${token}; Path=/${slug}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

// Thrown error responses (404 / 410 / 451 / 500) still carry the ADR-013 view
// header stack — notably HSTS — so even a first-ever request to view.<domain>
// that resolves to an error still sets the HSTS max-age in the browser. The
// bodies are all our own static strings (no untrusted content), so the strict
// CSP is fine. noindex.
function errorResponse(status: number, message: string): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(message, { status, headers });
}

// 200 "scanning…" holding page (ADR-0038 §2): a report exists but has no clean
// live version yet. Our own static HTML, so the strict view CSP + a meta-refresh
// (no script) are fine. noindex.
function scanningHoldingPage(): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="refresh" content="5" />
<title>Scanning…</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;text-align:center">
<h1>Scanning…</h1><p>This report is being checked. This page refreshes automatically.</p>
</body></html>`;
  return new Response(body, { status: 200, headers });
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { reports, blobs, grants } = viewerDeps();

  const slug = makeSlug(params.slug ?? "");
  // Unknown/invalid slug is indistinguishable from blocked content → 404.
  if (!slug.ok) throw errorResponse(404, "Not found");

  // ?v=N (issue #155, ADR-0038 §3): resolve a specific ReportVersion by ordinal
  // instead of the live version. Absent/malformed `v` parses to `undefined`
  // (parseVersionQuery), which resolveViewableReport treats identically to no
  // `v=` at all — the live-serving default is unchanged. The requested version
  // passes through the EXACT SAME scan-status state machine as the live path
  // (clean → serve, pending → scanning, flagged → 451, blocked/unknown → 404) —
  // see view-report.ts's resolveRequestedVersion.
  const url = new URL(request.url);
  const requestedVersionNo = parseVersionQuery(url.searchParams.get("v"));

  const outcome = await resolveViewableReport(slug.value, reports, requestedVersionNo);
  if (!outcome.ok) throw errorResponse(500, "Lookup failed");
  switch (outcome.value.kind) {
    case "deleted":
      throw errorResponse(410, "No longer available");
    case "flagged":
      throw errorResponse(451, "Unavailable — flagged for review");
    case "notfound":
      throw errorResponse(404, "Not found");
  }

  // Servable (clean live / clean ?v=N ordinal) OR still scanning → enforce the
  // Acl (ADR-0056) BEFORE emitting anything about the report. The holding page
  // sits behind the same gate as content (dogfood 2026-07-08): a private report
  // mid-scan must show a visitor exactly what it will show them once clean —
  // the unlock redirect — not a 200 that reveals the slug exists and is being
  // scanned. Same `report.acl`, same resolveAccessDecision call regardless of
  // which version was resolved above — ?v=N is not a separate gate, it's the
  // identical gate applied to a different version (ADR-0038 §3).
  const { report } = outcome.value;

  // The app authorizes private reports; the viewer only verifies a slug-bound token
  // (from the `?access` hand-off or a prior unlock cookie). Public reports serve directly.
  const { secret, appOrigin } = viewerAccessConfig();
  // Async + grant-aware: for `allowlist`, a valid token is only honored while its
  // `report_grants` row is live (revocation-C) — the per-request check (ADR-0056).
  const decided = await resolveAccessDecision(
    report.acl,
    report.id,
    { cookie: readUnlockCookie(request), query: url.searchParams.get("access") ?? undefined },
    slug.value,
    secret ?? "",
    Math.floor(Date.now() / 1000),
    grants,
  );
  if (!decided.ok) throw errorResponse(500, "Access check failed");
  const decision = decided.value;
  if (decision.kind === "unlock") {
    // Send the viewer to the app to authorize. Fail closed if the app origin is unset.
    if (!appOrigin) throw errorResponse(503, "Private report — viewing is not available here");
    const headers = viewHeaders();
    headers.set("location", `${appOrigin}/unlock/${slug.value}`);
    headers.set("cache-control", "no-store");
    return new Response(null, { status: 302, headers });
  }
  if (decision.kind === "grant") {
    // Valid hand-off → set the unlock cookie (lasting as long as the token/grant) and
    // redirect to the clean URL (drops the token from the address bar / history).
    const headers = viewHeaders();
    headers.set("location", `/${slug.value}`);
    headers.set("set-cookie", unlockCookie(slug.value, decision.token, decision.maxAgeSeconds));
    headers.set("cache-control", "no-store");
    return new Response(null, { status: 303, headers });
  }
  // Access granted. Mid-scan there is still no clean version to serve — the
  // authorized visitor (owner via /open, or anyone the mode admits, e.g. public)
  // gets the ADR-0038 §2 holding page, exactly as before.
  if (outcome.value.kind === "scanning") return scanningHoldingPage();
  const { version } = outcome.value;
  const blob = await blobs.readObject(report.id, version.id, version.manifest.entryDocument);
  if (!blob.ok) throw errorResponse(500, "Read failed");
  if (!blob.value) throw errorResponse(404, "Not found");

  const headers = viewHeaders();
  headers.set("content-type", blob.value.contentType);
  headers.set("cache-control", "no-store"); // never cache untrusted content
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(blob.value.bytes as unknown as BodyInit, { headers });
}
