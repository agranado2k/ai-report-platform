// GET /<slug>/edit — the authenticated, first-party-JS editing surface on the
// viewer origin (ADR-0063 Decisions 1-3, Phase 4). Supersedes the interim,
// unauthenticated 302-to-dashboard redirect (ADR-0063 Decision 3's fallback)
// now that the auth seam + edit-route CSP profile have landed. Mirrors
// `$slug.tsx`'s unlock-cookie flow, swapped for the edit token: a `?et=`
// hand-off sets a scoped cookie and 303s to the clean URL (keeping the token
// out of history/referer); a redeemed `arp_edit` cookie renders the editor;
// anything else (missing/invalid/expired token, no configured secret/app
// origin, or no editable document) degrades to the public, read-only viewer —
// this route NEVER renders the editor without a live, valid capability.
//
// Does NOT touch `$slug.tsx` (the public `GET /<slug>` route) — same disjoint
// Remix flat-route path as before (`/:slug/edit` vs `/:slug`), so the public
// viewer's behavior/headers are unaffected by anything in this file.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { resolveViewableReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { ReportEditor } from "arp-editor";
import { editViewHeaders, viewHeaders } from "arp-headers/view";
import { type PMDocJson, parseBody, type Shell, splitShell } from "arp-report-html";
import { Button, Card } from "arp-ui";
import { useRef, useState } from "react";
import { saveEdit } from "../edit/save-edit";
import { viewerAccessConfig, viewerDeps } from "../server/container.server";
import { buildEditCookie, readEditCookieValue, resolveEditAccess } from "../server/edit-session";

function notFoundResponse(): Response {
  const headers = viewHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response("Not found", { status: 404, headers });
}

// The fallback for every "can't/shouldn't render the editor" case below: an
// expired/invalid/absent edit capability just becomes a normal (possibly
// gated) view of the report, exactly like ADR-0056's unlock flow degrades to
// the public viewer rather than erroring. Uses `viewHeaders()` (the PUBLIC
// CSP profile), not `editViewHeaders()` — this response never carries editor
// content or the edit token, so it gets the stricter, unauthenticated-route
// header set.
function redirectToPublicViewer(slug: string): Response {
  const headers = viewHeaders();
  headers.set("location", `/${slug}`);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(null, { status: 302, headers });
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  // Validate the slug's SHAPE first — same rule as $slug.tsx and the interim
  // edit-redirect route: never build a Location/cookie Path out of an
  // unvalidated path segment.
  const slugR = makeSlug(params.slug ?? "");
  if (!slugR.ok) throw notFoundResponse();
  const slug = slugR.value;

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("et") ?? undefined;
  const cookieToken = readEditCookieValue(request.headers.get("cookie"));
  const { secret, appOrigin } = viewerAccessConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const decision = resolveEditAccess({ queryToken, cookieToken, slug, secret, nowSeconds });

  if (decision.kind === "denied") return redirectToPublicViewer(slug);

  if (decision.kind === "set-cookie") {
    // Valid `?et=` hand-off: mint the arp_edit cookie and 303 to the clean
    // URL — drops the token out of the address bar/history/referer, exactly
    // like $slug.tsx's `grant` → unlock-cookie flow.
    const headers = viewHeaders();
    headers.set("location", `/${slug}/edit`);
    headers.set("set-cookie", buildEditCookie(slug, decision.token, decision.maxAgeSeconds));
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(null, { status: 303, headers });
  }

  // decision.kind === "render": a valid, already-redeemed arp_edit cookie.
  // Never render the editor without a configured app origin — editViewHeaders
  // REQUIRES it for connect-src, and there would be nowhere for Save to POST
  // to anyway (mirrors the interim redirect route's fail-closed-on-unset-
  // APP_ORIGIN posture).
  if (!appOrigin) return redirectToPublicViewer(slug);

  const { reports, blobs } = viewerDeps();
  const outcome = await resolveViewableReport(slug, reports);
  // Any non-"serve" outcome (not found / deleted / flagged / still scanning)
  // or a lookup failure degrades to the public viewer, which already renders
  // the correct status page for every one of those states (ADR-0038 §2) —
  // this route doesn't duplicate that state machine, it only adds "render
  // the editor" on top of the one state where there's a document to edit.
  if (!outcome.ok || outcome.value.kind !== "serve") return redirectToPublicViewer(slug);
  const { report, version } = outcome.value;

  const blob = await blobs.readObject(report.id, version.id, version.manifest.entryDocument);
  if (!blob.ok || !blob.value) return redirectToPublicViewer(slug);

  let shell: Shell;
  let bodyHtml: string;
  try {
    ({ shell, bodyHtml } = splitShell(new TextDecoder().decode(blob.value.bytes)));
  } catch {
    // Malformed content (shouldn't happen for anything that passed the
    // upload pipeline) — never crash the edit route; fall back to read-only.
    return redirectToPublicViewer(slug);
  }

  // Lossless reopen when a prior editor save left a `_source.json` sidecar;
  // otherwise a best-effort HTML→PM parse (ADR-0062 §4) — mirrors
  // apps/app/app/routes/reports.$slug.edit.tsx's loader exactly.
  const sidecar = await blobs.readObject(report.id, version.id, "_source.json");
  const doc: PMDocJson =
    sidecar.ok && sidecar.value
      ? (JSON.parse(new TextDecoder().decode(sidecar.value.bytes)) as PMDocJson)
      : parseBody(bodyHtml);

  const headers = editViewHeaders({ appOrigin });
  headers.set("x-robots-tag", "noindex, nofollow");

  // SECURITY: `editToken` is returned to the CLIENT below (loader JSON,
  // hydrated into the page) so client JS can send it as an
  // `Authorization: Bearer` header on the cross-origin save (../edit/save-edit.ts).
  // This is safe DESPITE the token being readable by this page's own JS,
  // because the untrusted report content renders ONLY inside ReportEditor's
  // sandboxed `srcDoc` iframe (`sandbox="allow-same-origin"`, no
  // `allow-scripts` — packages/editor/src/ReportEditor.tsx). That iframe
  // executes no script of its own and cannot reach into the PARENT
  // document's JS context (the one holding `editToken`) — sandboxing without
  // `allow-scripts` means the report's own markup/CSS can render but nothing
  // in it can run. The token's real exposure boundary is instead this
  // route's OWN CSP (`editViewHeaders`'s `script-src 'self'`, no
  // `unsafe-inline`/`unsafe-eval`) — nothing but this app's first-party
  // bundle ever executes in the document that holds the token.
  return json(
    {
      doc,
      shell,
      slug,
      appOrigin,
      editToken: decision.token,
      docTitle: report.title,
    },
    { headers },
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditReport() {
  const { doc, shell, slug, appOrigin, editToken, docTitle } = useLoaderData<typeof loader>();
  const docRef = useRef<PMDocJson>(doc as PMDocJson);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSave() {
    setStatus("saving");
    setMessage(null);
    const result = await saveEdit({ appOrigin, slug, editToken, doc: docRef.current });
    if (result.ok) {
      setStatus("saved");
      setMessage(`Saved as v${result.version} — scan: ${result.scanStatus}`);
    } else {
      setStatus("error");
      setMessage(result.message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Centaur Spec</p>
          <h1 className="text-xl font-semibold text-fg">{docTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={status === "error" ? "text-sm text-danger" : "text-sm text-subtle"}
            role="status"
            aria-live="polite"
          >
            {status === "saving" ? "Saving…" : (message ?? "")}
          </span>
          <Button variant="primary" onClick={onSave} disabled={status === "saving"}>
            Save
          </Button>
        </div>
      </div>
      <Card className="p-6">
        <ReportEditor
          key={slug}
          initialDoc={doc as PMDocJson}
          shell={shell}
          onChange={(next) => {
            docRef.current = next;
          }}
          className="w-full min-h-[32rem] rounded-card border border-border"
        />
      </Card>
    </main>
  );
}
