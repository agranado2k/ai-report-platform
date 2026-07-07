import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import {
  createFolder,
  deleteFolder,
  deleteReport,
  listFolders,
  moveReport,
  renameFolder,
  renameReport,
  searchReports,
} from "arp-application";
import { folderIdToWire, makeFolderId, makeReportId, makeSlug, reportIdToWire } from "arp-domain";
import {
  AppHeader,
  Button,
  buttonClass,
  cx,
  DocumentIcon,
  EditableReportTitle,
  EmptyState,
  FolderIcon,
  type FolderNode,
  FolderTree,
  Input,
  MoreIcon,
  PageShell,
  Select,
  StatusBadge,
} from "../components";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo, identityStore, writeGrantStore } from "../server/container.server";
import { errorToJson } from "../server/http.server";
import { log } from "../server/log.server";

export const meta: MetaFunction = () => [
  { title: "Your reports — Centaur" },
  { name: "description", content: "Dashboard: your reports, organised in folders." },
];

const PAGE_SIZE = 20;

// Dashboard (ADR-0036, Reports & Folders): an org-wide, newest-first, paged +
// searchable report list with a folder sidebar. resolveActorForRead resolves the
// org WITHOUT provisioning (GETs stay safe). Query params: `?q=` (title/slug
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
  };
  if (!actor) return json(empty);

  // No pagination params → listFolders returns the WHOLE org folder tree in
  // one unpaginated page (the sidebar needs every folder to build it).
  const foldersR = await listFolders({ folders: folderRepo() }, { orgId: actor.orgId });
  if (!foldersR.ok) log.warn(`dashboard: listFolders failed — ${foldersR.error.message}`);
  const folders: FolderNode[] = (foldersR.ok ? foldersR.value.items : []).map((f) => ({
    id: folderIdToWire(f.id),
    parentId: f.parentId ? folderIdToWire(f.parentId) : null,
    name: f.name,
  }));
  const root = folders.find((f) => f.parentId === null) ?? null;
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

  const searchR = await searchReports(
    { reports: deps().reports },
    { orgId: actor.orgId },
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
    items: result.items.map((r) => ({
      ...r,
      id: reportIdToWire(r.id),
      folderId: folderIdToWire(r.folderId),
    })),
    hasPrev,
    hasNext,
    q,
    selectedFolderId,
    rootId: root?.id ?? null,
  });
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
    const r = await moveReport(
      {
        reports: deps().reports,
        folders: folderRepo(),
        grants: writeGrantStore(),
        identities: identityStore(),
      },
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
    const r = await renameReport(
      { reports: deps().reports, grants: writeGrantStore(), identities: identityStore() },
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
    const r = await deleteReport(
      { reports: deps().reports },
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
    const r = await renameFolder(
      { folders: folderRepo() },
      { orgId: actor.value.orgId },
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
    const r = await deleteFolder(
      { folders: folderRepo(), reports: deps().reports },
      { orgId: actor.value.orgId },
      { folderId: folderId.value },
    );
    if (!r.ok) return errorToJson(r.error);
    return redirect("/");
  }

  // new-folder (default): nest under the selected folder.
  const name = String(form.get("name") ?? "");
  const rawParent = String(form.get("parentId") ?? "").trim();
  if (!rawParent) return json({ error: "Select a folder to create in." }, { status: 400 });
  // Decode the parent's wire External Id at the boundary → 422 on a malformed
  // value; createFolder validates it's in the actor's org.
  const parentId = makeFolderId(rawParent);
  if (!parentId.ok) return errorToJson(parentId.error);

  const r = await createFolder(
    { folders: folderRepo(), ids: deps().ids },
    { orgId: actor.value.orgId },
    { parentId: parentId.value, name },
  );
  if (!r.ok) return errorToJson(r.error);
  return redirect(`/?folder=${rawParent}`);
}

export default function Index() {
  const { folders, items, hasPrev, hasNext, q, selectedFolderId, rootId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const childrenOf = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  const root = folders.find((f) => f.parentId === null);
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
          {root ? (
            <FolderTree
              node={root}
              childrenOf={childrenOf}
              selectedId={selectedFolderId}
              depth={0}
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
                  className="group flex items-center gap-3 border-b border-border py-3 last:border-0"
                >
                  {/* Document icon = open the report. Owner-open (ADR-0056): /reports/{slug}/open
                      mints an owner access token, so the owner reaches their own report directly —
                      no password / magic link even when it's private; the viewer still gates
                      everyone else. (The title click renames.) */}
                  <a
                    href={`/reports/${r.slug}/open`}
                    aria-label={`Open ${r.title}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface-raised text-subtle transition-colors hover:border-brand hover:text-brand"
                  >
                    <DocumentIcon className="h-4 w-4" />
                  </a>
                  <div className="min-w-0 flex-1">
                    <EditableReportTitle slug={r.slug} title={r.title} />
                    <div className="mt-0.5 flex items-center gap-2 pl-1.5 text-xs text-subtle">
                      <code className="font-mono">{r.slug}</code>
                      <span className="inline-flex items-center gap-1">
                        <FolderIcon className="h-3.5 w-3.5" />
                        {folderName(r.folderId)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge isPublished={r.isPublished} />
                  {/* Row actions behind a native <details> menu — no JS, CSP-safe. */}
                  <details className="relative shrink-0">
                    <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden">
                      <MoreIcon className="h-4 w-4" />
                      <span className="sr-only">Actions for {r.title}</span>
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 w-60 rounded-card border border-border bg-surface p-2 shadow-lg">
                      <Form method="post" className="flex items-center gap-1.5 p-1">
                        <input type="hidden" name="intent" value="move" />
                        <input type="hidden" name="slug" value={r.slug} />
                        <Select
                          name="toFolderId"
                          defaultValue={r.folderId}
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
            <Form method="post" className="mt-6 flex items-center gap-2">
              <input type="hidden" name="parentId" value={createParent} />
              <Input
                name="name"
                placeholder={
                  selectedFolderId ? `New folder in ${scopeLabel}` : "New folder (in Root)"
                }
                required
                className="w-64"
              />
              <Button type="submit" variant="secondary">
                + New folder
              </Button>
              {actionData && "error" in actionData && actionData.error ? (
                <span className="text-sm text-danger">✗ {actionData.error}</span>
              ) : null}
            </Form>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
