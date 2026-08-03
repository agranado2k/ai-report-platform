import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import {
  type AppError,
  folderIdToWire,
  makeFolderId,
  makeFolderVisibility,
  makeReportId,
  makeSlug,
  reportIdToWire,
  visibleFolderOrRoot,
} from "arp-domain";
import {
  AppHeader,
  Button,
  buttonClass,
  cx,
  EmptyState,
  FolderIcon,
  type FolderNode,
  type FolderShareRow,
  FolderTree,
  Input,
  MoreIcon,
  PageShell,
  RenameReportForm,
  Select,
  StatusBadge,
} from "../components";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { ops } from "../server/container.server";
import {
  applyFolderVisibility,
  cascadeIsPartial,
  cascadeLabel,
  cascadeScope,
  cascadeSummary,
  type FolderManagementActor,
  folderFormKey,
  folderManagement,
  folderShareWarning,
  folderVisibilityBadge,
  INERT_SHARE_NOTICE,
  ROSTER_UNAVAILABLE_NOTICE,
  visibleFolderTree,
} from "../server/folder-sharing.server";
import { errorToJson, errorToJsonParts } from "../server/http.server";
import { log } from "../server/log.server";

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
  // `?manage=<folder id>` opens ONE folder's sharing panel (ADR-0076 §6). It
  // is the only thing that makes this loader pay for a share roster — a roster
  // per sidebar folder would be an N+1 on the dashboard's hot path, and every
  // other folder's badge falls back to Private/Org rather than inventing a
  // count it never fetched.
  const manageRequested = url.searchParams.get("manage") ?? "";

  const actorR = await resolveActorForRead(args);
  // The dashboard degrades to an empty list for both "no actor" and an infra
  // failure (logged) — a rendered page beats a 500 here; the JSON API surfaces
  // the distinction (401 vs 500) instead.
  if (!actorR.ok) log.warn(`dashboard: resolveActorForRead failed — ${actorR.error.message}`);
  const actor = actorR.ok ? actorR.value : null;
  const empty = {
    folders: [] as FolderNode[],
    items: [],
    hasPrev: false,
    hasNext: false,
    q,
    selectedFolderId: null,
    rootId: null,
    manageFolderId: null as string | null,
    startingAfter: afterRaw ?? null,
    endingBefore: beforeRaw ?? null,
    inertShareNotice: INERT_SHARE_NOTICE,
    rosterUnavailableNotice: ROSTER_UNAVAILABLE_NOTICE,
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

  // The one share roster this page loads (see `manageRequested` above). Asking
  // for a folder that isn't manageable simply yields no roster — the use case
  // would 403/404 anyway, and the loader must not turn that into a page error.
  const manageTarget =
    grafted.find((f) => f.id === manageRequested && management.get(f.id)?.manageable) ?? null;
  let shares: readonly FolderShareRow[] | null = null;
  // The roster load FAILED (transient DB error, or an actor the use case
  // refuses). It must NOT collapse into an empty roster: that would render an
  // error as the positive claim "not shared with anyone — only you can see this
  // folder" for a folder that may be shared with five people. `null` already
  // means "unknown" throughout this module; this flag says WHY it is unknown.
  let sharesUnavailable = false;
  if (manageTarget) {
    const decoded = makeFolderId(manageTarget.id);
    if (decoded.ok) {
      const sharesR = await ops().listFolderShares(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        { folderId: decoded.value },
      );
      if (sharesR.ok) {
        shares = sharesR.value.map((s) => ({
          email: s.granteeEmail,
          // Formatted server-side so the markup is stable (no locale drift
          // between the SSR pass and hydration).
          grantedAt: new Date(s.grantedAt).toISOString().slice(0, 10),
        }));
      } else {
        log.warn(`dashboard: listFolderShares failed — ${sharesR.error.message}`);
        sharesUnavailable = true;
      }
    }
  }
  const folders: FolderNode[] = grafted.map((f) => {
    const own = manageTarget?.id === f.id ? shares : null;
    const m = management.get(f.id) ?? {
      isRoot: f.parentId === null,
      manageable: false,
      legacy: f.ownerId === null,
      blockedReason: null,
    };
    // The direction the toggle would take this folder, which is what makes the
    // warning and the checkbox label sayable up front.
    const target = f.visibility === "org" ? ("private" as const) : ("org" as const);
    const scope = m.manageable ? cascadeScope(grafted, f.id) : null;
    return {
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      visibility: f.visibility,
      isRoot: m.isRoot,
      manageable: m.manageable,
      blockedReason: m.blockedReason,
      shareWarning: scope ? folderShareWarning({ legacy: m.legacy, target, scope }) : null,
      cascadeLabel: scope ? cascadeLabel({ target, scope }) : null,
      shares: own,
      sharesUnavailable: manageTarget?.id === f.id && sharesUnavailable,
      badge: folderVisibilityBadge({
        visibility: f.visibility,
        shareCount: own?.length ?? null,
      }),
      // Both derive from the SAME two facts — what the org can see, and how
      // many people were added — so the badge and the forms can never disagree
      // about whether anything moved.
      formKey: folderFormKey({ visibility: f.visibility, shareCount: own?.length ?? null }),
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
      return {
        ...r,
        id: reportIdToWire(r.id),
        folderId,
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
    manageFolderId: manageTarget?.id ?? null,
    // The raw cursors, so "Manage who it's shared with →" can come back to the
    // page the operator was actually on.
    startingAfter: afterRaw ?? null,
    endingBefore: beforeRaw ?? null,
    inertShareNotice: INERT_SHARE_NOTICE,
    rosterUnavailableNotice: ROSTER_UNAVAILABLE_NOTICE,
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
}

/** A folder-scoped action failure: the same status `errorToHttp` gives the JSON
 *  API, tagged with the folder so the sidebar renders the reason on that row. */
function folderError(folderId: string, error: AppError) {
  const { message, status } = errorToJsonParts(error);
  const data: FolderActionData = { folderId, error: message, summary: null, partial: false };
  return json(data, { status });
}

/** A folder-scoped action success. */
function folderOk(folderId: string, summary: string, partial = false) {
  const data: FolderActionData = { folderId, error: null, summary, partial };
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
    return redirect(`/?folder=${rawTo}`);
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
    if (!slug.ok) return json({ error: "Invalid delete request." }, { status: 400 });
    const r = await ops().deleteReport(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { slug: slug.value },
    );
    if (!r.ok) return errorToJson(r.error);
    return redirect(folder ? `/?folder=${folder}` : "/");
  }

  if (intent === "rename-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const name = String(form.get("name") ?? "");
    if (!rawId) return json({ error: "Invalid rename request." }, { status: 400 });
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return errorToJson(folderId.error);
    const r = await ops().renameFolder(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { folderId: folderId.value, name },
    );
    if (!r.ok) return errorToJson(r.error);
    return redirect(`/?folder=${rawId}`);
  }

  if (intent === "delete-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    if (!rawId) return json({ error: "Invalid delete request." }, { status: 400 });
    const folderId = makeFolderId(rawId);
    if (!folderId.ok) return errorToJson(folderId.error);
    const r = await ops().deleteFolder(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      { folderId: folderId.value },
    );
    if (!r.ok) return errorToJson(r.error);
    return redirect("/");
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
  return redirect(`/?folder=${rawParent}`);
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
    manageFolderId,
    startingAfter,
    endingBefore,
    inertShareNotice,
    rosterUnavailableNotice,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // A sharing action's outcome (success summary OR the server's refusal),
  // tagged with the folder it belongs to.
  const folderOutcome = actionData && "folderId" in actionData ? actionData : null;
  const childrenOf = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  const root = folders.find((f) => f.parentId === null);
  // Plain lookup: the loader has already resolved every id the UI binds to
  // down to a folder that is actually in `folders` (see `displayFolderId`).
  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "—";
  const createParent = selectedFolderId ?? rootId;
  const scopeLabel = selectedFolderId ? folderName(selectedFolderId) : "All reports";

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

  // "Manage who it's shared with →" — the same page plus `?manage=<id>`, which
  // is what makes the loader fetch that ONE folder's share roster. Preserves
  // the active search + folder filter so the link never loses the user's place.
  const manageHref = (folderId: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (selectedFolderId) sp.set("folder", selectedFolderId);
    // The CURSOR too, or opening a folder's roster from page 3 silently resets
    // the report list to page 1 under the operator.
    if (startingAfter) sp.set("starting_after", startingAfter);
    if (endingBefore) sp.set("ending_before", endingBefore);
    sp.set("manage", folderId);
    return `/?${sp.toString()}`;
  };

  return (
    <PageShell>
      <AppHeader title="Your reports" />

      {/* Search (GET) — org-wide; preserves the folder filter when set. */}
      <Form method="get" className="mb-6 flex items-center gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search reports by title or slug…"
          aria-label="Search reports"
          className="w-full max-w-sm"
        />
        {selectedFolderId ? <input type="hidden" name="folder" value={selectedFolderId} /> : null}
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {q ? (
          <Link
            to={selectedFolderId ? `/?folder=${selectedFolderId}` : "/"}
            className="text-sm text-muted hover:text-fg"
          >
            Clear
          </Link>
        ) : null}
      </Form>

      <div className="flex items-start gap-6">
        {/* Sidebar: folder tree (clicking a folder filters the list). */}
        <nav className="w-56 shrink-0 border-r border-border pr-3">
          <Link
            to="/"
            className={cx(
              "block rounded-control py-1 pl-2 pr-2 text-sm no-underline transition-colors",
              selectedFolderId
                ? "text-fg hover:bg-surface-raised"
                : "bg-brand/10 font-semibold text-brand",
            )}
          >
            All reports
          </Link>
          {/* Sharing feedback (ADR-0076 §6). Lives ABOVE the tree because a
              visibility toggle can be fired from a kebab that closes on the
              next render — the operator must still see what happened, and a
              partial cascade must read as a warning, never as a success. */}
          {folderOutcome ? (
            <p
              role="status"
              className={cx(
                "my-2 rounded-control px-2 py-1.5 text-xs",
                folderOutcome.error
                  ? "bg-danger/10 text-danger"
                  : folderOutcome.partial
                    ? "bg-warning/12 text-warning"
                    : "bg-success/12 text-success",
              )}
            >
              <span className="font-medium">{folderName(folderOutcome.folderId)}: </span>
              {folderOutcome.error ?? folderOutcome.summary}
            </p>
          ) : null}
          {root ? (
            <FolderTree
              node={root}
              childrenOf={childrenOf}
              selectedId={selectedFolderId}
              depth={0}
              manageHref={manageHref}
              inertShareNotice={inertShareNotice}
              rosterUnavailableNotice={rosterUnavailableNotice}
              openMenuId={manageFolderId ?? folderOutcome?.folderId ?? null}
            />
          ) : (
            <p className="px-2 py-1 text-sm text-subtle">No folders yet.</p>
          )}
        </nav>

        {/* Contents: the paged report list + pagination + new-folder form. */}
        <section className="min-w-0 flex-1">
          <p className="mb-3 text-sm text-muted">
            <span className="font-medium text-fg">{scopeLabel}</span>
            {q ? ` · matching “${q}”` : ""} · {items.length}
            {hasNext ? "+" : ""} report{items.length === 1 && !hasNext ? "" : "s"}
          </p>
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
            <ul>
              {items.map((r) => (
                <li
                  key={r.slug}
                  className="relative flex items-center gap-3 border-b border-border py-3 transition-colors last:border-0 hover:bg-surface-raised"
                >
                  {/* Stretched-link pattern (CSP-safe, zero extra JS): this is the
                      ONLY thing that opens the report — clicking anywhere in the
                      row does. Owner-open (ADR-0056): /reports/{slug}/open mints an
                      owner access token, so the owner reaches their own report
                      directly — no password/magic link even when it's private; the
                      viewer still gates everyone else.

                      Z-INDEX LAYERING: this overlay is `absolute inset-0` with an
                      explicit `z-0`. Per CSS stacking rules, a positioned element
                      with z-index 0 paints ABOVE any plain, non-positioned in-flow
                      sibling (the title text, slug/folder line, status badge below)
                      even though the overlay is visually invisible — so clicks on
                      those regions correctly fall through to /open. The kebab
                      `<details>` is given `relative z-10` so IT (and everything
                      inside its panel — Move, Delete, Rename) wins the hit-test
                      over this overlay and is never swallowed by it. */}
                  <a
                    href={`/reports/${r.slug}/open`}
                    className="absolute inset-0 z-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <span className="sr-only">Open {r.title}</span>
                  </a>
                  <div className="min-w-0 flex-1">
                    <p className="block max-w-full truncate px-1.5 py-0.5 text-sm font-medium text-fg">
                      {r.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 pl-1.5 text-xs text-subtle">
                      <code className="font-mono">{r.slug}</code>
                      <span className="inline-flex items-center gap-1">
                        <FolderIcon className="h-3.5 w-3.5" />
                        {folderName(r.displayFolderId)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge isPublished={r.isPublished} />
                  {/* Row actions behind a native <details> menu — no JS, CSP-safe.
                      `relative z-10` lifts it (Move/Delete/Rename) above the
                      stretched-link overlay above. */}
                  <details className="relative z-10 shrink-0">
                    <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden">
                      <MoreIcon className="h-4 w-4" />
                      <span className="sr-only">Actions for {r.title}</span>
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 w-60 rounded-card border border-border bg-surface p-2 shadow-lg">
                      <RenameReportForm slug={r.slug} title={r.title} />
                      <Form method="post" className="flex items-center gap-1.5 p-1">
                        <input type="hidden" name="intent" value="move" />
                        <input type="hidden" name="slug" value={r.slug} />
                        <Select
                          name="toFolderId"
                          defaultValue={r.displayFolderId}
                          aria-label={`Move ${r.title} to folder`}
                          size="sm"
                          className="min-w-0 flex-1 text-xs"
                        >
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </Select>
                        <Button type="submit" size="sm">
                          Move
                        </Button>
                      </Form>
                      <Form method="post" className="p-1">
                        <input type="hidden" name="intent" value="delete-report" />
                        <input type="hidden" name="slug" value={r.slug} />
                        <input type="hidden" name="folder" value={r.folderId} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="danger"
                          className="w-full justify-start"
                        >
                          Delete report
                        </Button>
                      </Form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
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
            // KEYED on how many folders the sidebar is showing, for the same
            // reason the sharing forms are keyed on their folder's state: a
            // successful create changes the count, remounts this form, and the
            // name that was just used stops sitting in the field waiting to be
            // submitted a second time (2026-08-03 dogfood, I-4 — pre-existing,
            // not from #230/#234). A REFUSED create leaves the count alone, so
            // the rejected name stays put to be edited and retried.
            <Form
              method="post"
              key={`new-folder-${folders.length}`}
              className="mt-6 flex items-center gap-2"
            >
              <input type="hidden" name="parentId" value={createParent} />
              <Input
                name="name"
                placeholder={
                  selectedFolderId ? `New folder in ${scopeLabel}` : "New folder (in Root)"
                }
                required
                autoComplete="off"
                className="w-64"
              />
              <Button type="submit" variant="secondary">
                + New folder
              </Button>
              {/* NEW-FOLDER failures only. Every folder-sharing failure also
                  carries `error`, so an unnarrowed guard rendered a refusal on
                  a colleague's folder here too — a second time, next to
                  "+ New folder", reading as if folder creation had failed.
                  `folderOutcome` is the sharing channel; this is not it. */}
              {!folderOutcome && actionData && "error" in actionData && actionData.error ? (
                <span className="text-sm text-danger">✗ {actionData.error}</span>
              ) : null}
            </Form>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
