import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Link, useActionData, useLoaderData } from "@remix-run/react";
import {
  type AppError,
  folderIdToWire,
  makeFolderId,
  makeFolderVisibility,
  makeReportId,
  makeReportSharingState,
  makeSlug,
  reportIdToWire,
  validationError,
  visibleFolderOrRoot,
} from "arp-domain";
import { AppHeader, buttonClass, cx, EmptyState, PageShell } from "../components";
import {
  FolderManagePanel,
  type FolderManageNode,
} from "../components/folders/FolderManagePanel";
import { NewFolderDialog } from "../components/folders/NewFolderDialog";
import { ReportFilter } from "../components/reports/ReportFilter";
import { ReportRow } from "../components/reports/ReportRow";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { ops } from "../server/container.server";
import { editabilityNotice } from "../server/editability-notice.server";
import {
  applyFolderVisibility,
  cascadeIsPartial,
  cascadeSummary,
  type FolderManagementActor,
  folderManagement,
  type FolderOutcomeTone,
  folderOutcomeTone,
  folderVisibilityBadge,
  INERT_SHARE_NOTICE,
  ROSTER_UNAVAILABLE_NOTICE,
  visibleFolderTree,
} from "../server/folder-sharing.server";

/** The dashboard's per-folder shape (ADR-0087): the cheap, tree-derived facts
 *  the content-header panel and the Move control need. The roster, the
 *  roster-derived badge count and the bulk-apply count are loaded lazily by the
 *  panel, not here. */
type DashboardFolder = FolderManageNode & { readonly parentId: string | null };
import { errorToJson, errorToJsonParts } from "../server/http.server";
import { log } from "../server/log.server";
import {
  confirmDiscardFromForm,
  PERSON_SHARE_LIMIT_NOTICE,
  reportFormKey,
  reportSharingBadge,
  reportSharingManagement,
  SHARING_CHOICES,
  sharingApplyIsPartial,
  sharingApplySummary,
} from "../server/report-sharing.server";

export const meta: MetaFunction = () => [
  { title: "Your reports — Centaur" },
  { name: "description", content: "Dashboard: your reports, organised in folders." },
];

const PAGE_SIZE = 20;

// Dashboard (ADR-0036, Reports & Folders): an org-wide, newest-first, paged +
// searchable report list with a folder sidebar. resolveActorForRead resolves
// the org — lazily provisioning the identity mirror on a first-ever read
// (ADR-0048 amendment 2026-08-01), so a genuine org member who has only ever
// viewed still gets their org's dashboard. Query params: `?q=` (title/slug
// search), `?folder=<id>` (filter to one folder), `?page=` (1-based).
export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const requestedFolder = url.searchParams.get("folder") ?? "";
  // Cursor pagination (ADR-0053): report-id cursors carried in the dashboard URL,
  // as the SAME wire-encoded `report_` External Id the JSON API uses (ADR-0052) —
  // the ids below are wire-encoded on the way out, so the links this page renders
  // (cursorHref) round-trip through here. A malformed/tampered cursor decodes to
  // an error, which we log and treat as absent (a bad param degrades to page 1
  // rather than a hard failure — this is a page load, not the JSON API's 422
  // boundary).
  const afterRaw = url.searchParams.get("starting_after") || undefined;
  const beforeRaw = url.searchParams.get("ending_before") || undefined;
  // The per-folder share roster + bulk-apply count are no longer loaded here
  // (ADR-0087): the content-header panel pays for them lazily, only when
  // "Manage ▾" is opened, over GET /shares?include=manage. The dashboard loader
  // now computes only the cheap, tree-derived facts every folder needs.

  const actorR = await resolveActorForRead(args);
  // The dashboard degrades to an empty list for both "no actor" and an infra
  // failure (logged) — a rendered page beats a 500 here; the JSON API surfaces
  // the distinction (401 vs 500) instead.
  if (!actorR.ok) log.warn(`dashboard: resolveActorForRead failed — ${actorR.error.message}`);
  const actor = actorR.ok ? actorR.value : null;
  const empty = {
    folders: [] as DashboardFolder[],
    items: [],
    hasPrev: false,
    hasNext: false,
    q,
    selectedFolderId: null,
    rootId: null,
    startingAfter: afterRaw ?? null,
    endingBefore: beforeRaw ?? null,
    inertShareNotice: INERT_SHARE_NOTICE,
    rosterUnavailableNotice: ROSTER_UNAVAILABLE_NOTICE,
    sharingChoices: SHARING_CHOICES,
    personShareLimitNotice: PERSON_SHARE_LIMIT_NOTICE,
  };
  if (!actor) return json(empty);

  // No pagination params → listFolders returns the whole VISIBLE folder tree
  // (ADR-0076: this user's owned + legacy + org-visible + shared-with-them
  // folders) in one unpaginated page (the sidebar needs every visible folder
  // to build it).
  const foldersR = await ops().listFolders({ orgId: actor.orgId, userId: actor.userId }, {});
  if (!foldersR.ok) log.warn(`dashboard: listFolders failed — ${foldersR.error.message}`);
  // ONE tree construction — wire ids plus the partial-visibility graft
  // (ADR-0076 §5) — shared with the cascade, which depends on the graft for
  // its SCOPE ("everything inside this folder" must mean what the sidebar
  // shows inside it).
  const domainFolders = foldersR.ok ? foldersR.value.items : [];
  const grafted = visibleFolderTree(domainFolders);
  const root = grafted.find((f) => f.parentId === null) ?? null;
  // ADR-0076 §6: `manageable` / `blockedReason` / the warning are decided HERE,
  // by the SAME domain predicates `loadManagedFolder` enforces, and shipped to
  // the sidebar as plain data — dashboard components must never import
  // `arp-domain` (its barrel pulls `node:crypto` into the client bundle), and
  // they must never re-derive an authorization rule of their own.
  const managementActor = { userId: actor.userId, scopes: actor.scopes };
  const management = new Map(
    domainFolders.map((f) => [folderIdToWire(f.id), folderManagement(f, managementActor)]),
  );

  // The cheap, tree-derived facts every folder needs (ADR-0087). The roster,
  // the roster-derived badge count, the bulk-apply count AND the warning /
  // cascade label are NOT computed here any more — the content-header panel
  // loads them lazily on "Manage ▾" (GET /shares?include=manage). The badge is
  // the count-less one (Org / Limited / Private); the panel upgrades it to
  // "Shared with N" once it has the roster.
  const folders: DashboardFolder[] = grafted.map((f) => {
    const m = management.get(f.id) ?? {
      isRoot: f.parentId === null,
      manageable: false,
      legacy: f.ownerId === null,
      blockedReason: null,
    };
    return {
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      visibility: f.visibility,
      isRoot: m.isRoot,
      manageable: m.manageable,
      blockedReason: m.blockedReason,
      badge: folderVisibilityBadge({ visibility: f.visibility, shareCount: null }),
    };
  });
  // Only honor a folder filter that exists in the org (this existence check also
  // guards against a garbage `?folder=` value — it simply won't match).
  const selectedFolderId =
    requestedFolder && folders.some((f) => f.id === requestedFolder) ? requestedFolder : null;
  const selectedFolderIdDecoded = selectedFolderId ? makeFolderId(selectedFolderId) : undefined;
  if (selectedFolderIdDecoded && !selectedFolderIdDecoded.ok) {
    log.warn(`dashboard: malformed folder id in query — ${selectedFolderIdDecoded.error.message}`);
  }
  const after = afterRaw ? makeReportId(afterRaw) : undefined;
  if (after && !after.ok)
    log.warn(`dashboard: malformed starting_after cursor — ${after.error.message}`);
  const before = beforeRaw ? makeReportId(beforeRaw) : undefined;
  if (before && !before.ok)
    log.warn(`dashboard: malformed ending_before cursor — ${before.error.message}`);

  // Visibility-scoped (ADR-0075): the list shows only what THIS user may see —
  // their own reports, org/public-shared ones, and write-granted ones.
  const searchR = await ops().searchReports(
    { orgId: actor.orgId, userId: actor.userId },
    {
      query: q || undefined,
      folderId: selectedFolderIdDecoded?.ok ? selectedFolderIdDecoded.value : undefined,
      limit: PAGE_SIZE,
      startingAfter: after?.ok ? after.value : undefined,
      endingBefore: before?.ok ? before.value : undefined,
    },
  );
  if (!searchR.ok) log.warn(`dashboard: searchReports failed — ${searchR.error.message}`);
  const result = searchR.ok ? searchR.value : { items: [], hasMore: false };

  // `has_more` is the repo's frontier IN THE FETCH DIRECTION. Forward (or first
  // page): it's "more after" = Next; a forward page also has a Prev (newer items).
  // Backward (ending_before): it's "more before" = Prev, and there's always a Next
  // (the page we came from). Translate to explicit hasPrev/hasNext for the UI.
  // Based on the RAW param's presence, not decode success — a malformed cursor
  // degrades to page 1 above, and page 1 has no Prev regardless.
  const back = Boolean(beforeRaw);
  const hasNext = back ? true : result.hasMore;
  const hasPrev = back ? result.hasMore : Boolean(afterRaw);

  return json({
    folders,
    items: result.items.map((r) => {
      const folderId = folderIdToWire(r.folderId);
      // ADR-0078 §12: `manageable` / `blockedReason` / the badge / the discard
      // warning are decided HERE, by the same predicates `setReportSharing`
      // enforces, and shipped as plain data. `ownerId` is NOT among the fields
      // spread below — the server sends conclusions, never the authorization
      // input (the `folderManagement` doctrine).
      const sharing = reportSharingManagement(
        {
          ownerId: r.ownerId,
          aclMode: r.aclMode,
          hasOrgWrite: r.hasOrgWrite,
          // The REAL roster size, off the same free join (ADR-0078 §4) — the
          // warning must name the N the server's own refusal names.
          allowedEmailCount: r.allowedEmailCount,
        },
        actor ? { userId: actor.userId, scopes: actor.scopes } : null,
      );
      return {
        id: reportIdToWire(r.id),
        slug: r.slug,
        title: r.title,
        isPublished: r.isPublished,
        folderId,
        // ADR-0080 — the server's own sentence for "why can't I edit this?",
        // or null when there is nothing to say. A conclusion, not the verdict
        // itself: the component renders it, it never re-decides it.
        editabilityNotice: editabilityNotice(r.editability),
        sharing: {
          slug: r.slug,
          title: r.title,
          badge: reportSharingBadge({ aclMode: r.aclMode, hasOrgWrite: r.hasOrgWrite }),
          manageable: sharing.manageable,
          blockedReason: sharing.blockedReason,
          state: sharing.state,
          discardWarning: sharing.discardWarning,
          formKey: reportFormKey({ aclMode: r.aclMode, hasOrgWrite: r.hasOrgWrite }),
        },
        // A visible report can live in an INVISIBLE folder (ADR-0075/0076), so
        // its folderId resolves to nothing in `folders`. Resolve the id the UI
        // should BIND to here, on the server, where arp-domain is already
        // loaded: the label groups it under Root's name rather than leaking
        // anything, and the Move control preselects Root rather than whatever
        // option the browser picks first for an unmatched <select> value.
        displayFolderId: root ? visibleFolderOrRoot(folderId, folders, root.id) : folderId,
      };
    }),
    hasPrev,
    hasNext,
    q,
    selectedFolderId,
    rootId: root?.id ?? null,
    // The raw cursors, preserved so pagination survives a filter change.
    startingAfter: afterRaw ?? null,
    endingBefore: beforeRaw ?? null,
    inertShareNotice: INERT_SHARE_NOTICE,
    rosterUnavailableNotice: ROSTER_UNAVAILABLE_NOTICE,
    sharingChoices: SHARING_CHOICES,
    personShareLimitNotice: PERSON_SHARE_LIMIT_NOTICE,
  });
}

/** The shape EVERY ADR-0076 sharing action returns, success or failure — one
 *  shape, so the sidebar renders the outcome without discriminating a union.
 *  `error` and `summary` are mutually exclusive; `partial` is true only for a
 *  cascade that could not change every descendant. */
interface FolderActionData {
  readonly folderId: string;
  readonly error: string | null;
  readonly summary: string | null;
  readonly partial: boolean;
  /** The success/warning/danger tone, decided server-side (ADR-0087) so the
   *  content-header panel need not import the domain to map it. */
  readonly tone: FolderOutcomeTone;
}

/** The shape every ADR-0078 report-sharing action returns, success or failure.
 *  `pendingSharing` is the state the operator asked for on a submit the server
 *  refused for want of confirmation — echoed back so the panel can offer the
 *  confirm button for THAT choice, and null otherwise (so a plain refusal
 *  never renders a confirm button for something nobody asked for). */
interface ReportActionData {
  readonly reportSlug: string;
  readonly error: string | null;
  readonly summary: string | null;
  readonly pendingSharing: string | null;
}

function reportError(reportSlug: string, error: AppError, pendingSharing: string | null = null) {
  const { message, status } = errorToJsonParts(error);
  const data: ReportActionData = { reportSlug, error: message, summary: null, pendingSharing };
  return json(data, { status });
}

function reportOk(reportSlug: string, summary: string) {
  const data: ReportActionData = { reportSlug, error: null, summary, pendingSharing: null };
  return json(data);
}

/** A folder-scoped action failure: the same status `errorToHttp` gives the JSON
 *  API, tagged with the folder so the sidebar renders the reason on that row. */
function folderError(folderId: string, error: AppError) {
  const { message, status } = errorToJsonParts(error);
  const data: FolderActionData = {
    folderId,
    error: message,
    summary: null,
    partial: false,
    tone: folderOutcomeTone({ error: message, partial: false }),
  };
  return json(data, { status });
}

/** A folder-scoped action success. */
function folderOk(folderId: string, summary: string, partial = false) {
  const data: FolderActionData = {
    folderId,
    error: null,
    summary,
    partial,
    tone: folderOutcomeTone({ error: null, partial }),
  };
  return json(data);
}

// Folder writes (provisioning resolver). intent=move → reassign a report's
// folder; otherwise create a folder under the selected one. The use cases
// validate org ownership of the report/parent/target.
export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    return errorToJson(actor.error);
  }
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "new-folder");

  if (intent === "move") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const rawTo = String(form.get("toFolderId") ?? "").trim();
    if (!slug.ok || !rawTo) return json({ error: "Invalid move request." }, { status: 400 });
    // Decode the target folder's wire External Id at the boundary → 422 on a
    // malformed value, instead of silently coercing it into a branded id
    // (api.v1.reports.$slug.move.ts follows the same pattern).
    const toFolderId = makeFolderId(rawTo);
    if (!toFolderId.ok) return errorToJson(toFolderId.error);
    const r = await ops().moveReport(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { slug: slug.value, toFolderId: toFolderId.value },
    );
    if (!r.ok) return errorToJson(r.error);
    return redirect(`/?folder=${rawTo}&flash=report-moved`);
  }

  if (intent === "rename-report") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const title = String(form.get("title") ?? "");
    if (!slug.ok) return json({ error: "Invalid rename request." }, { status: 400 });
    const r = await ops().renameReport(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { slug: slug.value, title },
    );
    if (!r.ok) return errorToJson(r.error);
    // Inline rename submits via useFetcher — return JSON so the dashboard
    // revalidates in place instead of navigating (the old form-POST redirected).
    return json({ ok: true });
  }

  if (intent === "delete-report") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const folder = String(form.get("folder") ?? "").trim();
    // The report title rides along so the success toast can name what was
    // deleted (report §08); it never reaches a use case — purely for the flash.
    const title = String(form.get("title") ?? "").trim();
    if (!slug.ok) return json({ error: "Invalid delete request." }, { status: 400 });
    const r = await ops().deleteReport(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { slug: slug.value },
    );
    if (!r.ok) return errorToJson(r.error);
    const flash = new URLSearchParams({ flash: "report-deleted" });
    if (folder) flash.set("folder", folder);
    if (title) flash.set("title", title);
    return redirect(`/?${flash.toString()}`);
  }

  // ── ADR-0078 §12: report sharing, from the dashboard ────────────────────
  // Posts to the SAME use case the /api/v1 route calls, through this
  // cookie-authenticated Remix action — the browser never touches the Bearer
  // API. `resolveUploadActor` carries SELF_SCOPES, which includes `acl:write`.
  if (intent === "set-report-sharing") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    if (!slug.ok) return reportError("", slug.error);
    const rawSlug = String(form.get("slug") ?? "");
    // ONE validator, shared with the JSON API route and the MCP tool.
    const sharing = makeReportSharingState(String(form.get("sharing") ?? ""));
    if (!sharing.ok) return reportError(rawSlug, sharing.error);
    // The zero-JS confirmation (ADR-0078 §4): only the SECOND submit — the one
    // rendered under the sentence naming what is discarded — carries this.
    const confirmDiscard = confirmDiscardFromForm(form.get("confirm_discard"));
    const r = await ops().setReportSharing(
      { orgId: actor.value.orgId, userId: actor.value.userId, scopes: actor.value.scopes },
      { slug: slug.value, sharing: sharing.value, confirmDiscard },
    );
    if (!r.ok) {
      // A refusal for want of confirmation is not a dead end: echo back WHICH
      // state was asked for, so the panel can render the confirm button for
      // exactly that choice rather than making the operator start over.
      return reportError(rawSlug, r.error, confirmDiscard ? null : sharing.value);
    }
    return reportOk(rawSlug, `Sharing set to ${sharing.value.replace("_", " ")}.`);
  }

  if (intent === "apply-folder-sharing") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    const sharing = makeReportSharingState(String(form.get("sharing") ?? ""));
    if (!sharing.ok) return folderError(rawId, sharing.error);
    const r = await ops().applyFolderSharingToReports(
      { orgId: actor.value.orgId, userId: actor.value.userId, scopes: actor.value.scopes },
      { folderId: folderId.value, sharing: sharing.value },
    );
    // A refusal here is the server's own (403, 404, or the 422 pre-flight cap)
    // and nothing was changed.
    if (!r.ok) return folderError(rawId, r.error);
    // A run that could not change every candidate is NOT a success — the
    // banner renders as a warning and names each report and why. The condition
    // lives in `sharingApplyIsPartial`, under test, rather than as an
    // expression here that could be inverted without a test noticing.
    return folderOk(rawId, sharingApplySummary(r.value), sharingApplyIsPartial(r.value));
  }

  if (intent === "rename-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const name = String(form.get("name") ?? "");
    if (!rawId) return folderError(rawId, validationError("Invalid rename request.", "name"));
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    const r = await ops().renameFolder(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { folderId: folderId.value, name },
    );
    if (!r.ok) return folderError(rawId, r.error);
    // Submitted from the content-header panel via useFetcher (ADR-0087): return
    // the folder-scoped outcome so the panel revalidates the loader in place and
    // renders a toast, instead of the old full-page redirect+flash.
    return folderOk(rawId, `Renamed to ${r.value.name}.`);
  }

  if (intent === "delete-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    if (!rawId) return folderError(rawId, validationError("Invalid delete request.", "folderId"));
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    const r = await ops().deleteFolder(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { folderId: folderId.value },
    );
    if (!r.ok) return folderError(rawId, r.error);
    // Deleting the SELECTED folder is the one management write that navigates
    // (ADR-0087): back to All-reports, with a mutation toast (#336). The panel's
    // fetcher follows this redirect.
    return redirect("/?flash=folder-deleted");
  }

  // ── ADR-0076 §6: folder visibility + sharing, from the dashboard ─────────
  // These post to the SAME use cases the `/api/v1/folders/{id}/…` routes call,
  // through this cookie-authenticated Remix action — the browser never touches
  // the Bearer API. `resolveUploadActor` carries `SELF_SCOPES`, which includes
  // the `acl:write` these three gate on.
  const managementActor: FolderManagementActor = {
    orgId: actor.value.orgId,
    userId: actor.value.userId,
    scopes: actor.value.scopes,
  };

  if (intent === "set-folder-visibility") {
    const rawId = String(form.get("folderId") ?? "").trim();
    // Every exit from these three intents returns the FolderActionData shape —
    // a bare `{ error }` here would be invisible to the sidebar banner, which
    // discriminates on `folderId`, and would instead surface next to
    // "+ New folder" as if folder creation had failed.
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    // The same validator the JSON API route uses (arp-domain).
    const visibility = makeFolderVisibility(String(form.get("visibility") ?? ""));
    if (!visibility.ok) return folderError(rawId, visibility.error);

    const outcome = await applyFolderVisibility(ops(), managementActor, {
      folderWireId: rawId,
      folderId: folderId.value,
      visibility: visibility.value,
      cascade: form.get("cascade") !== null,
    });
    // A refusal here is the server's own (403 non-owner, 422 Root, 422 "too
    // many folders inside") — nothing was changed.
    if (!outcome.ok) return folderError(rawId, outcome.error);
    // A cascade that could not touch every descendant is NOT a success — the
    // banner renders as a warning and names each folder and why. The condition
    // lives in `cascadeIsPartial`, under test, rather than as an expression
    // here that could be inverted without a single test noticing.
    return folderOk(rawId, cascadeSummary(outcome.value), cascadeIsPartial(outcome.value));
  }

  if (intent === "share-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    const email = String(form.get("email") ?? "").trim();
    const r = await ops().shareFolder(managementActor, { folderId: folderId.value, email });
    if (!r.ok) return folderError(rawId, r.error);
    // Idempotent by design (an upsert): re-sharing the same address simply
    // refreshes the row, so the UI says "shared with" either way.
    return folderOk(rawId, `Shared with ${r.value.granteeEmail}.`);
  }

  if (intent === "unshare-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return folderError(rawId, folderId.error);
    const email = String(form.get("email") ?? "").trim();
    const r = await ops().unshareFolder(managementActor, { folderId: folderId.value, email });
    if (!r.ok) return folderError(rawId, r.error);
    // Idempotent too: revoking an address with no share still succeeds, so a
    // stale panel or a double-click never surfaces a false failure.
    return folderOk(rawId, `Removed ${email}.`);
  }

  // new-folder (default): nest under the selected folder.
  const name = String(form.get("name") ?? "");
  const rawParent = String(form.get("parentId") ?? "").trim();
  if (!rawParent) return json({ error: "Select a folder to create in." }, { status: 400 });
  // Decode the parent's wire External Id at the boundary → 422 on a malformed
  // value; createFolder validates it's in the actor's org.
  const parentId = makeFolderId(rawParent);
  if (!parentId.ok) return errorToJson(parentId.error);

  const r = await ops().createFolder(
    { orgId: actor.value.orgId, userId: actor.value.userId },
    { parentId: parentId.value, name },
  );
  if (!r.ok) return errorToJson(r.error);
  return redirect(`/?folder=${rawParent}&flash=folder-created`);
}

export default function Index() {
  const {
    folders,
    items,
    hasPrev,
    hasNext,
    q,
    selectedFolderId,
    rootId,
    inertShareNotice,
    rosterUnavailableNotice,
    sharingChoices,
    personShareLimitNotice,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // A report sharing action's outcome, tagged with the report it belongs to.
  // Folder-management outcomes no longer arrive here (ADR-0087): the panel posts
  // its writes via useFetcher and renders their outcome itself.
  const reportOutcome = actionData && "reportSlug" in actionData ? actionData : null;
  // Plain lookup: the loader has already resolved every id the UI binds to
  // down to a folder that is actually in `folders` (see `displayFolderId`).
  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "—";
  const createParent = selectedFolderId ?? rootId;
  const scopeLabel = selectedFolderId ? folderName(selectedFolderId) : "All reports";
  // The selected folder's management node (ADR-0087) — the content-header panel
  // renders for it; no selection (or Root) shows just the filter + report list.
  const selectedFolder = selectedFolderId
    ? (folders.find((f) => f.id === selectedFolderId) ?? null)
    : null;

  // Cursor links (ADR-0053) preserve the active search + folder filter; the cursor
  // is the boundary report id (forward = starting_after, back = ending_before).
  const cursorHref = (cursor?: { starting_after?: string; ending_before?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (selectedFolderId) sp.set("folder", selectedFolderId);
    if (cursor?.starting_after) sp.set("starting_after", cursor.starting_after);
    if (cursor?.ending_before) sp.set("ending_before", cursor.ending_before);
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <PageShell>
      <AppHeader title="Your reports" />

      {/* Filter-as-you-type (#334): debounced ?q= navigation, no submit; "/"
          focuses it. The folder filter is preserved and the cursor resets
          (report-filter.ts). */}
      <div className="mb-6 flex items-center gap-2">
        <ReportFilter defaultQuery={q} />
      </div>

      {/* The folder-navigation rail now lives in the `_app` shell (ADR-0087);
          the dashboard body is the report list, headed — when a folder is
          selected — by its content-header management panel. The panel renders
          nothing for Root or a non-selection. */}
      <div className="min-w-0">
        {selectedFolder ? (
          <FolderManagePanel
            node={selectedFolder}
            inertShareNotice={inertShareNotice}
            rosterUnavailableNotice={rosterUnavailableNotice}
            personShareLimitNotice={personShareLimitNotice}
          />
        ) : null}

        <section className="min-w-0">
          <p className="mb-3 text-sm text-muted">
            <span className="font-medium text-fg">{scopeLabel}</span>
            {q ? ` · matching “${q}”` : ""} · {items.length}
            {hasNext ? "+" : ""} report{items.length === 1 && !hasNext ? "" : "s"}
          </p>
          {reportOutcome ? (
            <p
              role="status"
              className={cx(
                "mb-3 rounded-control px-2 py-1.5 text-xs",
                reportOutcome.error ? "bg-danger/10 text-danger" : "bg-success/12 text-success",
              )}
            >
              <span className="font-medium">{reportOutcome.reportSlug}: </span>
              {reportOutcome.error ?? reportOutcome.summary}
            </p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title={q ? "No matching reports" : "No reports here yet"}
              description={
                q
                  ? "Try a different search term or clear the filter."
                  : "Upload a report to get started."
              }
              action={
                q ? undefined : (
                  <Link to="/upload" className={buttonClass("primary")}>
                    Upload a report
                  </Link>
                )
              }
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-border">
              {/* Visual column header; the rows below are a real <ul>/<li> so
                  list semantics (lost when T4a replaced the <ul> with a div
                  grid — #346) are restored. A full ARIA table with column
                  association is the interaction ticket's call (#347). */}
              <div
                aria-hidden="true"
                className="grid grid-cols-[1fr_7rem_auto_2.5rem] items-center gap-3 border-b border-border bg-bg px-3 py-2 text-xs font-medium text-muted"
              >
                <span>Name</span>
                <span>Status</span>
                <span>Sharing</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="list-none">
                {items.map((r) => (
                  <ReportRow
                    key={r.slug}
                    report={r}
                    folders={folders}
                    folderLabel={folderName(r.displayFolderId)}
                    sharingChoices={sharingChoices}
                    pendingSharing={
                      reportOutcome?.reportSlug === r.slug
                        ? (reportOutcome.pendingSharing ?? null)
                        : null
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {hasPrev || hasNext ? (
            <div className="mt-4 flex items-center gap-3 text-sm">
              {hasPrev ? (
                <Link
                  to={cursorHref(items[0] ? { ending_before: items[0].id } : undefined)}
                  className="text-brand hover:text-brand-hover"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="text-subtle">← Prev</span>
              )}
              {hasNext ? (
                <Link
                  to={cursorHref(
                    items.length ? { starting_after: items[items.length - 1]?.id } : undefined,
                  )}
                  className="text-brand hover:text-brand-hover"
                >
                  Next →
                </Link>
              ) : (
                <span className="text-subtle">Next →</span>
              )}
            </div>
          ) : null}

          {createParent ? (
            // Creating a folder gets a deliberate dialog step (#336, report §02)
            // — the inline field became the "New folder" dialog, also reachable
            // from the ⌘K palette. It posts the SAME `new-folder` intent the
            // action (and the e2e suite) already drive. A REFUSED create echoes
            // its error back here; the dialog re-opens with the rejected name to
            // fix. NEW-FOLDER failures only: a report outcome (`reportSlug`) and
            // a folder-management outcome (`folderId`, now delivered to the
            // panel's fetcher, not here) both also carry `error`, so the guard
            // excludes them — otherwise a colleague's refusal would surface here.
            <div className="mt-6">
              <NewFolderDialog
                key={`new-folder-${folders.length}`}
                parentId={createParent}
                parentLabel={selectedFolderId ? scopeLabel : "Root"}
                error={
                  actionData &&
                  !("reportSlug" in actionData) &&
                  !("folderId" in actionData) &&
                  "error" in actionData &&
                  actionData.error
                    ? actionData.error
                    : null
                }
              />
            </div>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
