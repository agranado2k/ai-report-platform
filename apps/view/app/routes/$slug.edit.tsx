// GET /<slug>/edit — the authenticated, first-party-JS unified editing
// experience on the viewer origin (ADR-0063 Decisions 1-3, Phase 4;
// unified-experience epic on top). Supersedes the interim, unauthenticated
// 302-to-dashboard redirect (ADR-0063 Decision 3's fallback) now that the
// auth seam + edit-route CSP profile have landed. Mirrors `$slug.tsx`'s
// unlock-cookie flow, swapped for the edit token: a `?et=` hand-off sets a
// scoped cookie and 303s to the clean URL (keeping the token out of
// history/referer); a redeemed `arp_edit` cookie renders the unified editor;
// anything else (missing/invalid/expired token, no configured secret/app
// origin, or no editable document) degrades to the public, read-only viewer —
// this route NEVER renders the editor without a live, valid capability.
//
// Does NOT touch `$slug.tsx` (the public `GET /<slug>` route) — same disjoint
// Remix flat-route path as before (`/:slug/edit` vs `/:slug`), so the public
// viewer's behavior/headers are unaffected by anything in this file.
//
// UNIFIED-EXPERIENCE ADDITIONS (on top of the 4c-2a auth seam + editor +
// save, which are unchanged below): the loader additionally loads the
// report's Comments + Versions server-side (Bearer, server-to-server — no
// CORS involved, see ../edit/comments-client.ts / ../edit/versions-client.ts)
// once the SAME auth decision below has already resolved to "render". The
// component adds the app-styled chrome (TopBar), a tabbed Comments|Versions
// left panel (hidden by default — the document is the dominant element), a
// View⇄Edit toggle, and Compare (visual diff). View mode and Compare BOTH
// render through `SandboxedHtml` (a fully sandboxed, no-`allow-scripts`,
// no-`allow-same-origin` `srcDoc` iframe built by `buildReadOnlyIframeDocument`
// — arp-editor) — never `dangerouslySetInnerHTML`, never on the app origin
// (F-1, claude-review #183 / ADR-0063's "4c client" note).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { resolveViewableReport } from "arp-application";
import { makeSlug, versionIdToWire } from "arp-domain";
import { type EditorSelection, ReportEditor } from "arp-editor";
import { editViewHeaders, viewHeaders } from "arp-headers/view";
import {
  type PMDocJson,
  parseBody,
  reinjectShell,
  type Shell,
  serializeBody,
  splitShell,
} from "arp-report-html";
import { Card } from "arp-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { listComments } from "../edit/comments-client";
import { CommentsPanel } from "../edit/components/CommentsPanel";
import { SandboxedHtml } from "../edit/components/SandboxedHtml";
import { TopBar, type ViewerMode } from "../edit/components/TopBar";
import type { PanelTab } from "../edit/components/types";
import { VersionsPanel } from "../edit/components/VersionsPanel";
import { EXPIRED_MESSAGE } from "../edit/http";
import { buildEditLoaderExtras } from "../edit/loader-data";
import { isEditTokenExpired, nextRefreshDelayMs, refreshEditToken } from "../edit/refresh-token";
import { saveEdit } from "../edit/save-edit";
import { listVersions } from "../edit/versions-client";
import type { CommentWire, DiffWire, VersionWire } from "../edit/wire-types";
import { viewerAccessConfig, viewerDeps } from "../server/container.server";
import {
  buildEditCookie,
  degradeLocation,
  readEditCookieValue,
  resolveEditAccess,
} from "../server/edit-session";

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
//
// `oa`, when present (hotfix — see `degradeLocation`'s doc), routes an OWNER
// through the viewer's existing `?access=` flow instead of the bare gated
// viewer, so a broken edit-token round-trip degrades to a read-only OWNER
// view of their own report rather than cascading to `/unlock/{slug}`.
function redirectToPublicViewer(slug: string, oa?: string): Response {
  const headers = viewHeaders();
  headers.set("location", degradeLocation(slug, oa));
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
  // Hotfix fallback (see `degradeLocation`'s doc): the fallback owner access
  // token `ownerOpenLocation` mints alongside `et=` for actual owners, ONLY
  // consulted when the edit-token round-trip below is denied.
  const oa = url.searchParams.get("oa") ?? undefined;
  const cookieToken = readEditCookieValue(request.headers.get("cookie"));
  const { secret, appOrigin } = viewerAccessConfig();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const decision = resolveEditAccess({ queryToken, cookieToken, slug, secret, nowSeconds });

  if (decision.kind === "denied") return redirectToPublicViewer(slug, oa);

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

  // Comments + Versions (unified-experience epic): loaded SERVER-SIDE, via
  // the SAME Bearer edit token, against the app-origin REST API — this is a
  // server-to-server call (Vercel function → app.<domain>), so no CORS is
  // involved (CORS only governs BROWSER-initiated cross-origin requests).
  // Best-effort: a failure here never blocks opening the editor — the tabs
  // just render empty until the user's own client-side actions succeed (see
  // buildEditLoaderExtras).
  const [commentsResult, versionsResult] = await Promise.all([
    listComments({ appOrigin, slug, editToken: decision.token }),
    listVersions({ appOrigin, slug, editToken: decision.token }),
  ]);
  const { comments, versions } = buildEditLoaderExtras(commentsResult, versionsResult);

  const headers = editViewHeaders({ appOrigin });
  headers.set("x-robots-tag", "noindex, nofollow");

  // SECURITY: `editToken` is returned to the CLIENT below (loader JSON,
  // hydrated into the page) so client JS can send it as an
  // `Authorization: Bearer` header on every cross-origin call (save, comments,
  // versions, diff — ../edit/*-client.ts, all copying ../edit/save-edit.ts's
  // pattern). This is safe DESPITE the token being readable by this page's
  // own JS, because ALL untrusted content — the report body in the editor
  // AND in View mode, and the visual diff — renders ONLY inside a sandboxed
  // iframe with no `allow-scripts` (packages/editor/src/ReportEditor.tsx for
  // the editor; ../edit/components/SandboxedHtml.tsx, using the stricter
  // `sandbox=""`, for View mode and Compare). Those iframes execute no
  // script of their own and cannot reach into the PARENT document's JS
  // context (the one holding `editToken`) — the token's real exposure
  // boundary is instead this route's OWN CSP (`editViewHeaders`'s
  // `script-src 'self'`, no `unsafe-inline`/`unsafe-eval`) — nothing but
  // this app's first-party bundle ever executes in the document that holds
  // the token.
  return json(
    {
      doc,
      shell,
      slug,
      appOrigin,
      editToken: decision.token,
      // The validated token's expiry (epoch seconds) — decoded from the
      // `EditClaims` `resolveEditAccess` already parsed above, never
      // re-parsed from the raw token client-side. Drives the silent-refresh
      // timer (ADR-0063 Phase 5) in the component below.
      editTokenExp: decision.claims.exp,
      docTitle: report.title,
      versionId: versionIdToWire(version.id),
      comments,
      versions,
    },
    { headers },
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

// Silent-refresh timing (ADR-0063 Phase 5): refresh this long before the
// current token would actually expire — generous enough to absorb clock
// drift + a slow request, small enough that the refresh never competes with
// an in-flight save/comment write for the same 15-min window
// (EDIT_TTL_SECONDS, apps/app/app/server/open-report.server.ts).
const REFRESH_SKEW_MS = 120_000; // 2 min
// A transient (network/5xx) refresh failure retries on a short fixed
// cadence rather than waiting out the remaining TTL — plenty of headroom
// inside REFRESH_SKEW_MS's 2-min margin for a few attempts before expiry.
const REFRESH_RETRY_MS = 30_000; // 30s

export default function EditReport() {
  const {
    doc,
    shell,
    slug,
    appOrigin,
    editToken: initialEditToken,
    editTokenExp: initialEditTokenExp,
    docTitle,
    versionId: initialVersionId,
    comments: initialComments,
    versions: initialVersions,
  } = useLoaderData<typeof loader>();

  const docRef = useRef<PMDocJson>(doc as PMDocJson);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  // The unified experience opens READ-ONLY by default — the View⇄Edit
  // toggle promotes to the editor; it does not open into it.
  const [mode, setMode] = useState<ViewerMode>("view");
  // View mode's initial render needs a snapshot ready immediately (default
  // mode is now "view"), so this is seeded from the loader's doc rather
  // than left `null` until the first mode switch.
  const [viewHtml, setViewHtml] = useState<string | null>(() =>
    reinjectShell(shell, serializeBody(doc as PMDocJson)),
  );
  const [diffData, setDiffData] = useState<DiffWire | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>(null);
  const [comments, setComments] = useState<readonly CommentWire[]>(initialComments);
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  // The edit token + its expiry, refreshed silently in the background (the
  // effect below). EVERY cross-origin write (save, comments, versions) must
  // read these CURRENT values, not the loader's originals — passed down as
  // `editToken`/`editTokenExp` throughout this component, same identifiers
  // the loader destructure used to use, so no call site below needs to know
  // it's now state rather than a loader constant.
  const [editToken, setEditToken] = useState(initialEditToken);
  const [editTokenExp, setEditTokenExp] = useState(initialEditTokenExp);
  // Mirrors of the two state values above, read by the refresh effect's
  // recursive scheduler so it always sees the latest token/expiry without
  // needing to re-run (and re-arm a duplicate timer) on every state change.
  const editTokenRef = useRef(editToken);
  const editTokenExpRef = useRef(editTokenExp);

  // versionId/versions: also promoted to state (were plain loader constants
  // before) so a successful save can advance them post-hoc — see onSave's
  // post-save re-fetch below (claude-review #184 finding #1).
  const [versionId, setVersionId] = useState(initialVersionId);
  const [versions, setVersions] = useState<readonly VersionWire[]>(initialVersions);

  // Silent token refresh (ADR-0063 Phase 5): the edit token is short-lived
  // (15 min) — without this, an editing session dies mid-edit the moment it
  // expires. Schedules a refresh REFRESH_SKEW_MS before the CURRENT token's
  // expiry; on success, advances editToken/editTokenExp (state, for
  // rendering/props below) and the refs (so the next scheduled refresh
  // reads the fresh expiry without waiting on a re-render), then
  // reschedules. A 401/403 (`expired`) means the token — or the underlying
  // write grant — is no longer valid: nothing left to do but surface the
  // same "reopen from the dashboard" message saveEdit's own failures show,
  // and stop refreshing (no reschedule). Any other failure (network blip,
  // 5xx) retries shortly rather than giving up on the whole session over a
  // transient error.
  //
  // Runs once per mount (`appOrigin`/`slug` are stable for the route's
  // lifetime) rather than re-running on every editToken/editTokenExp
  // change, so a single recursive `setTimeout` chain owns the schedule —
  // `cancelled` guards every `setState` inside it against firing after
  // unmount, and the cleanup clears whichever timer (scheduled refresh OR
  // a transient retry) is currently pending.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function scheduleRefresh() {
      const delayMs = nextRefreshDelayMs(
        editTokenExpRef.current,
        Math.floor(Date.now() / 1000),
        REFRESH_SKEW_MS,
      );
      // A delay of 0 (already inside the margin, or already expired) fires
      // on the next tick — i.e. "refresh immediately" — never a negative
      // timeout.
      timeoutId = setTimeout(runRefresh, delayMs);
    }

    async function runRefresh() {
      const result = await refreshEditToken({
        appOrigin,
        slug,
        editToken: editTokenRef.current,
      });
      if (cancelled) return;

      if (result.ok) {
        editTokenRef.current = result.editToken;
        editTokenExpRef.current = result.expiresAt;
        setEditToken(result.editToken);
        setEditTokenExp(result.expiresAt);
        scheduleRefresh();
        return;
      }

      if (result.expired) {
        setStatus("error");
        setMessage(result.message);
        return; // irrecoverable client-side — stop refreshing.
      }

      // Transient failure (network/5xx): retry soon rather than waiting
      // out the remaining TTL and losing the session over a blip — BUT only
      // while the current token is still alive. If it has already passed its
      // expiry (claude-review #185: a fully-offline client's `fetch` keeps
      // rejecting, so it never gets the 401 that would stop it), a refresh can
      // no longer succeed — the app rejects the now-expired presented token —
      // so stop retrying a dead token forever and surface the expired state.
      if (isEditTokenExpired(editTokenExpRef.current, Math.floor(Date.now() / 1000))) {
        setStatus("error");
        setMessage(EXPIRED_MESSAGE);
        return;
      }
      timeoutId = setTimeout(runRefresh, REFRESH_RETRY_MS);
    }

    scheduleRefresh();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [appOrigin, slug]);

  // Only OPEN ROOT comments drive the editor's highlight decorations
  // (claude-review #184): a resolved thread no longer needs its anchor
  // highlighted, and a reply shares its parent's anchor — passing replies too
  // would just stack a duplicate range at the same offsets. The CommentsPanel
  // still receives the FULL `comments` list (it renders resolved threads +
  // replies); only the highlight feed is narrowed.
  const highlightComments = useMemo(
    () => comments.filter((c) => c.resolved_at === null && c.parent_id === null),
    [comments],
  );

  async function onSave() {
    setStatus("saving");
    setMessage(null);
    const result = await saveEdit({ appOrigin, slug, editToken, doc: docRef.current });
    if (result.ok) {
      setStatus("saved");
      setMessage(`Saved as v${result.version} — scan: ${result.scanStatus}`);
      // Post-save staleness fix (claude-review #184 finding #1): the save
      // response only carries the new version's NUMBER, not its id, so
      // `versionId` (new comments' anchor pin) and `versions` (the
      // Versions/Compare tab) would otherwise keep pointing at whatever was
      // current when the editor opened. Re-fetch the list to pick up the
      // newly-created version's id. Best-effort — a failed re-fetch just
      // leaves the prior versionId/versions state in place rather than
      // crashing a save that already succeeded.
      const refreshed = await listVersions({ appOrigin, slug, editToken });
      if (refreshed.ok) {
        setVersions(refreshed.versions);
        const newest = [...refreshed.versions].sort((a, b) => b.version_no - a.version_no)[0];
        if (newest) setVersionId(newest.id);
      }
    } else {
      setStatus("error");
      setMessage(result.message);
    }
  }

  // View mode renders a SNAPSHOT of the current (possibly unsaved) editor
  // content — recomputed fresh every time the user switches to View, not
  // continuously while editing (ReportEditor keeps running underneath,
  // hidden — see below — so no edits are ever lost by toggling modes).
  function selectMode(next: "edit" | "view") {
    if (next === "view") {
      setViewHtml(reinjectShell(shell, serializeBody(docRef.current)));
    }
    setMode(next);
  }

  function closeCompare() {
    setDiffData(null);
    setMode("edit");
  }

  function toggleTab(tab: "comments" | "versions") {
    setActiveTab((current) => (current === tab ? null : tab));
  }

  const diffHtml = diffData ? reinjectShell(shell, diffData.html) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        docTitle={docTitle}
        mode={mode}
        onSelectMode={selectMode}
        onCloseCompare={closeCompare}
        activeTab={activeTab}
        onToggleTab={toggleTab}
        commentCount={comments.length}
        saveStatus={status === "saving" ? "Saving…" : (message ?? "")}
        saveDisabled={status === "saving"}
        onSave={onSave}
      />

      <div className="flex min-h-0 flex-1">
        {activeTab ? (
          <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface p-4">
            {activeTab === "comments" ? (
              <CommentsPanel
                appOrigin={appOrigin}
                slug={slug}
                editToken={editToken}
                currentVersionId={versionId}
                comments={comments}
                onCommentsChange={setComments}
                pendingSelection={mode === "edit" ? selection : null}
                onSelectionConsumed={() => setSelection(null)}
              />
            ) : (
              <VersionsPanel
                appOrigin={appOrigin}
                slug={slug}
                editToken={editToken}
                versions={versions}
                onCompare={(diff) => {
                  setDiffData(diff);
                  setMode("diff");
                }}
              />
            )}
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 overflow-auto p-6">
          {/* ReportEditor stays mounted at ALL times (even when hidden) so
              in-progress edits are never lost by switching to View/Compare —
              the mode switch only toggles visibility via CSS. */}
          <div className={mode === "edit" ? "" : "hidden"}>
            <Card className="p-6">
              <ReportEditor
                key={slug}
                initialDoc={doc as PMDocJson}
                shell={shell}
                comments={highlightComments}
                onChange={(next) => {
                  docRef.current = next;
                }}
                onSelectionChange={setSelection}
                className="w-full min-h-[32rem] rounded-card border border-border"
              />
            </Card>
          </div>

          {mode === "view" && viewHtml ? (
            <Card className="p-6">
              <SandboxedHtml
                html={viewHtml}
                title="Report preview"
                className="w-full min-h-[32rem] rounded-card border border-border"
              />
            </Card>
          ) : null}

          {mode === "diff" && diffData && diffHtml ? (
            <Card className="p-6">
              <p className="mb-3 text-sm font-medium text-fg">
                Comparing v{diffData.from.version_no} → v{diffData.to.version_no}
              </p>
              {diffData.diff_mode === "fallback" && diffData.label ? (
                <p className="mb-4 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  {diffData.label}
                </p>
              ) : null}
              <SandboxedHtml
                html={diffHtml}
                title="Version diff"
                className="w-full min-h-[32rem] rounded-card border border-border"
              />
            </Card>
          ) : null}
        </main>
      </div>
    </div>
  );
}
