// ⚠️ FILENAME IS LOAD-BEARING: `$slug_.edit.tsx`, NOT `$slug.edit.tsx`. The
// trailing `_` on the `$slug_` segment opts this route OUT of Remix v2
// flat-route dot-nesting. As `$slug.edit.tsx` it became a CHILD of
// `$slug.tsx` (the public viewer) — so `GET /:slug/edit` ran the PARENT
// viewer loader FIRST, which redirects any PRIVATE report to
// `${appOrigin}/unlock/{slug}` before this loader ever ran. Net: the editor
// was structurally unreachable for every private report (an owner was told to
// "unlock" their own report — the P0 that shipped from #184 undetected because
// no test exercised real Remix route resolution). Keep the underscore; a
// regression guard lives in `edit/edit-route-nesting.test.ts`, and the 4c
// cross-origin editor e2e renders this route end-to-end.
//
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
// component adds the app-styled chrome (TopBar), a COLLAPSIBLE Comments|Versions
// side panel (collapsed by default behind a badged edge affordance — the
// document is the dominant element; edit-chrome-cleanup), and Compare (visual
// diff). On /edit the user is ALWAYS editing — the old View⇄Edit toggle is
// gone; Compare is the only non-edit mode. Compare renders through
// `SandboxedHtml` (a fully sandboxed, no-`allow-scripts`, no-`allow-same-origin`
// `srcDoc` iframe built by `buildReadOnlyIframeDocument` — arp-editor) — never
// `dangerouslySetInnerHTML`, never on the app origin (F-1, claude-review #183 /
// ADR-0063's "4c client" note).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { resolveViewableReport } from "arp-application";
import { makeSlug, versionIdToWire } from "arp-domain";
import { type EditorSelection, ReportEditor } from "arp-editor";
import { editViewHeaders, viewHeaders } from "arp-headers/view";
import { type PMDocJson, parseBody, reinjectShell, type Shell, splitShell } from "arp-report-html";
import { useEffect, useMemo, useRef, useState } from "react";
import { listComments } from "../edit/comments-client";
import { CommentsPanel } from "../edit/components/CommentsPanel";
import { PanelHeader, PanelToggle } from "../edit/components/PanelChrome";
import { SandboxedHtml } from "../edit/components/SandboxedHtml";
import { TopBar, type ViewerMode } from "../edit/components/TopBar";
import { VersionsPanel } from "../edit/components/VersionsPanel";
import { EXPIRED_MESSAGE } from "../edit/http";
import { buildEditLoaderExtras } from "../edit/loader-data";
import {
  closePanel,
  INITIAL_PANEL_STATE,
  openPanel,
  type PanelState,
  selectPanelTab,
  unresolvedCount,
} from "../edit/panel";
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

  if (decision.kind === "denied") {
    // Observability (claude-review #187): when an OWNER's edit-token round-trip
    // is denied and we degrade them to a read-only owner view (`oa` present),
    // emit a structured signal. This is the exact secret-misalignment class of
    // incident that — before this log — could only be inferred from user
    // reports. Vercel captures `console` output to the function logs; the view
    // origin has no logger of its own (ADR-0038 keeps it minimal), so a bare
    // `console.warn` is the dependency-free signal here. Never logs the token.
    if (oa) {
      console.warn(
        JSON.stringify({ event: "owner-edit-degraded-to-view", slug, reason: "edit-token-denied" }),
      );
    }
    return redirectToPublicViewer(slug, oa);
  }

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
  const { comments, versions, commentsHasMore, versionsHasMore } = buildEditLoaderExtras(
    commentsResult,
    versionsResult,
  );

  // The list clients now follow the ADR-0053 cursor envelope to load the FULL
  // comment/version set (closing claude-review #184's silent >100 truncation),
  // so `has_more` here is normally false. It can only be true if the fetch-all
  // loop hit its safety page cap — a report so large the client bailed. Rather
  // than DISCARD that signal (the old bug), emit it: same dependency-free
  // `console.warn`-to-Vercel-logs pattern as the owner-degrade log above
  // (ADR-0038 keeps this origin logger-less). Never blocks the render.
  if (commentsResult.ok && commentsResult.has_more) {
    console.warn(JSON.stringify({ event: "edit-comments-truncated-at-cap", slug }));
  }
  if (versionsResult.ok && versionsResult.has_more) {
    console.warn(JSON.stringify({ event: "edit-versions-truncated-at-cap", slug }));
  }

  const headers = editViewHeaders({ appOrigin });
  headers.set("x-robots-tag", "noindex, nofollow");

  // SECURITY: `editToken` is returned to the CLIENT below (loader JSON,
  // hydrated into the page) so client JS can send it as an
  // `Authorization: Bearer` header on every cross-origin call (save, comments,
  // versions, diff — ../edit/*-client.ts, all copying ../edit/save-edit.ts's
  // pattern). This is safe DESPITE the token being readable by this page's
  // own JS, because ALL untrusted content — the report body in the editor
  // and the visual diff — renders ONLY inside a sandboxed
  // iframe with no `allow-scripts` (packages/editor/src/ReportEditor.tsx for
  // the editor; ../edit/components/SandboxedHtml.tsx, using the stricter
  // `sandbox=""`, for Compare). Those iframes execute no
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
      // Whether either list was truncated at the fetch-all page cap — drives the
      // "some older items are hidden" note in the panels (normally false).
      commentsHasMore,
      versionsHasMore,
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
    commentsHasMore,
    versionsHasMore: initialVersionsHasMore,
  } = useLoaderData<typeof loader>();

  const docRef = useRef<PMDocJson>(doc as PMDocJson);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  // On /edit the user is ALWAYS editing (edit-chrome-cleanup): the route opens
  // straight into the editor — no View⇄Edit toggle to promote through. The only
  // other mode is Compare ("diff"), entered from the Versions panel.
  const [mode, setMode] = useState<ViewerMode>("edit");
  const [diffData, setDiffData] = useState<DiffWire | null>(null);
  // The side panel: collapsed by default (document-dominant), with a remembered
  // inner tab. Replaces the old `activeTab: "comments"|"versions"|null` — see
  // ../edit/panel.ts for the pure state helpers.
  const [panel, setPanel] = useState<PanelState>(INITIAL_PANEL_STATE);
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
  // Whether the version history was truncated at the fetch-all cap — kept in
  // state because onSave re-fetches the list (below) and can flip it.
  const [versionsHasMore, setVersionsHasMore] = useState(initialVersionsHasMore);

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
        setVersionsHasMore(refreshed.has_more);
        const newest = [...refreshed.versions].sort((a, b) => b.version_no - a.version_no)[0];
        if (newest) setVersionId(newest.id);
      }
    } else {
      setStatus("error");
      setMessage(result.message);
    }
  }

  function closeCompare() {
    setDiffData(null);
    setMode("edit");
  }

  // The collapsed-edge badge + the in-panel Comments tab label both surface the
  // number of ACTIVE (unresolved root) comment threads — same filter as the
  // editor's highlight feed, minus the reply exclusion the highlights also make.
  const activeCommentCount = useMemo(() => unresolvedCount(comments), [comments]);

  const diffHtml = diffData ? reinjectShell(shell, diffData.html) : null;

  return (
    // data-testid: the ONLY reliable "the unified editor genuinely mounted"
    // signal for the cross-origin e2e (tests/e2e/smoke/editor-auth.steps.ts) —
    // this route degrades to the public viewer (redirectToPublicViewer, no
    // TopBar/ReportEditor at all) on every "can't render" branch above, so
    // this element's presence is equivalent to reaching the "render" decision
    // kind, i.e. the et= token round-trip + APP_ORIGIN wiring both worked.
    <div className="flex h-dvh flex-col overflow-hidden" data-testid="unified-editor">
      <TopBar
        docTitle={docTitle}
        mode={mode}
        onCloseCompare={closeCompare}
        saveStatus={status === "saving" ? "Saving…" : (message ?? "")}
        saveDisabled={status === "saving"}
        onSave={onSave}
      />

      <div className="flex min-h-0 flex-1">
        {/* The document pane fills the viewport height and scrolls on its OWN
            (the report iframe carries the scroll), edge-to-edge with no chrome
            padding — it should read like a real web page, not a card in a form. */}
        <main className="min-w-0 flex-1 overflow-hidden">
          {/* ReportEditor stays mounted at ALL times (even when hidden) so
              in-progress edits are never lost by switching to Compare — the mode
              switch only toggles visibility via CSS. `h-full` makes the iframe
              fill the pane so the report body (inside it) is what scrolls. */}
          <div className={mode === "edit" ? "h-full" : "hidden"}>
            <ReportEditor
              key={slug}
              initialDoc={doc as PMDocJson}
              shell={shell}
              comments={highlightComments}
              onChange={(next) => {
                docRef.current = next;
              }}
              onSelectionChange={setSelection}
              className="h-full w-full border-0"
            />
          </div>

          {mode === "diff" && diffData && diffHtml ? (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-border px-6 py-3">
                <p className="text-sm font-medium text-fg">
                  Comparing v{diffData.from.version_no} → v{diffData.to.version_no}
                </p>
                {diffData.diff_mode === "fallback" && diffData.label ? (
                  <p className="mt-2 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    {diffData.label}
                  </p>
                ) : null}
              </div>
              <SandboxedHtml
                html={diffHtml}
                title="Version diff"
                className="min-h-0 w-full flex-1 border-0"
              />
            </div>
          ) : null}
        </main>

        {panel.open ? (
          // Full-height panel: the tab header stays put, and ONLY the
          // comments/versions list below it scrolls — its own independent
          // scrollbar, separate from the document pane's.
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-surface">
            <div className="shrink-0 px-4 pt-4">
              <PanelHeader
                tab={panel.tab}
                unresolvedCount={activeCommentCount}
                onSelectTab={(tab) => setPanel((p) => selectPanelTab(p, tab))}
                onClose={() => setPanel((p) => closePanel(p))}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {panel.tab === "comments" ? (
                <CommentsPanel
                  appOrigin={appOrigin}
                  slug={slug}
                  editToken={editToken}
                  currentVersionId={versionId}
                  comments={comments}
                  hasMore={commentsHasMore}
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
                  hasMore={versionsHasMore}
                  onCompare={(diff) => {
                    setDiffData(diff);
                    setMode("diff");
                  }}
                />
              )}
            </div>
          </aside>
        ) : (
          // Collapsed-edge affordance: a `‹` chevron pinned to the top-right of
          // the document, badged with the active-comment count. Opens to Comments.
          <div className="shrink-0">
            <PanelToggle
              unresolvedCount={activeCommentCount}
              onOpen={() => setPanel(openPanel("comments"))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
