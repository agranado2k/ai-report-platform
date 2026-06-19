import { SignedIn, UserButton } from "@clerk/remix";
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
  moveReport,
  renameFolder,
  renameReport,
  searchReports,
} from "arp-application";
import { folderId, makeSlug } from "arp-domain";
import {
  AppHeader,
  Button,
  buttonClass,
  cx,
  EmptyState,
  type FolderNode,
  FolderTree,
  Input,
  PageShell,
  Select,
  StatusBadge,
} from "../components";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo, viewOrigin } from "../server/container.server";

export const meta: MetaFunction = () => [
  { title: "Your reports — ai-report-platform" },
  { name: "description", content: "Dashboard: your reports, organised in folders." },
];

const PAGE_SIZE = 20;

// Dashboard (ADR-0036, Reports & Folders): an org-wide, newest-first, paged +
// searchable report list with a folder sidebar. resolveActorForRead resolves the
// org WITHOUT provisioning (GETs stay safe). Query params: `?q=` (title/slug
// search), `?folder=<id>` (filter to one folder), `?page=` (1-based).
export async function loader(args: LoaderFunctionArgs) {
  const viewBase = viewOrigin(args.request);
  const url = new URL(args.request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const requestedFolder = url.searchParams.get("folder") ?? "";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const actorR = await resolveActorForRead(args);
  // The dashboard degrades to an empty list for both "no actor" and an infra
  // failure (logged) — a rendered page beats a 500 here; the JSON API surfaces
  // the distinction (401 vs 500) instead.
  if (!actorR.ok) console.warn(`dashboard: resolveActorForRead failed — ${actorR.error.message}`);
  const actor = actorR.ok ? actorR.value : null;
  const empty = {
    folders: [] as FolderNode[],
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    q,
    selectedFolderId: null,
    rootId: null,
    viewBase,
  };
  if (!actor) return json(empty);

  const foldersR = await folderRepo().listByOrg(actor.orgId);
  if (!foldersR.ok) console.warn(`dashboard: listFolders failed — ${foldersR.error.message}`);
  const folders: FolderNode[] = (foldersR.ok ? foldersR.value : []).map((f) => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
  }));
  const root = folders.find((f) => f.parentId === null) ?? null;
  // Only honor a folder filter that exists in the org.
  const selectedFolderId =
    requestedFolder && folders.some((f) => f.id === requestedFolder) ? requestedFolder : null;

  const searchR = await searchReports(
    { reports: deps().reports },
    { orgId: actor.orgId },
    {
      query: q || undefined,
      folderId: selectedFolderId ? folderId(selectedFolderId) : undefined,
      page,
      pageSize: PAGE_SIZE,
    },
  );
  if (!searchR.ok) console.warn(`dashboard: searchReports failed — ${searchR.error.message}`);
  const result = searchR.ok ? searchR.value : { items: [], total: 0, page: 1, pageSize: PAGE_SIZE };

  return json({
    folders,
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    q,
    selectedFolderId,
    rootId: root?.id ?? null,
    viewBase,
  });
}

// Folder writes (provisioning resolver). intent=move → reassign a report's
// folder; otherwise create a folder under the selected one. The use cases
// validate org ownership of the report/parent/target.
export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    return json({ error: "Couldn't verify your account. Please try again." }, { status: 500 });
  }
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "new-folder");

  if (intent === "move") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const rawTo = String(form.get("toFolderId") ?? "").trim();
    if (!slug.ok || !rawTo) return json({ error: "Invalid move request." }, { status: 400 });
    const r = await moveReport(
      { reports: deps().reports, folders: folderRepo() },
      { orgId: actor.value.orgId },
      { slug: slug.value, toFolderId: folderId(rawTo) },
    );
    if (!r.ok) return json({ error: r.error.message }, { status: 400 });
    return redirect(`/?folder=${rawTo}`);
  }

  if (intent === "rename-report") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const title = String(form.get("title") ?? "");
    const folder = String(form.get("folder") ?? "").trim();
    if (!slug.ok) return json({ error: "Invalid rename request." }, { status: 400 });
    const r = await renameReport(
      { reports: deps().reports },
      { orgId: actor.value.orgId },
      { slug: slug.value, title },
    );
    if (!r.ok) {
      return json(
        { error: r.error.message },
        { status: r.error.kind === "ValidationError" ? 422 : 400 },
      );
    }
    return redirect(folder ? `/?folder=${folder}` : "/");
  }

  if (intent === "delete-report") {
    const slug = makeSlug(String(form.get("slug") ?? ""));
    const folder = String(form.get("folder") ?? "").trim();
    if (!slug.ok) return json({ error: "Invalid delete request." }, { status: 400 });
    const r = await deleteReport(
      { reports: deps().reports },
      { orgId: actor.value.orgId },
      { slug: slug.value },
    );
    if (!r.ok) {
      return json(
        { error: r.error.message },
        { status: r.error.kind === "ValidationError" ? 422 : 400 },
      );
    }
    return redirect(folder ? `/?folder=${folder}` : "/");
  }

  if (intent === "rename-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    const name = String(form.get("name") ?? "");
    if (!rawId) return json({ error: "Invalid rename request." }, { status: 400 });
    const r = await renameFolder(
      { folders: folderRepo() },
      { orgId: actor.value.orgId },
      { folderId: folderId(rawId), name },
    );
    if (!r.ok) {
      return json(
        { error: r.error.message },
        { status: r.error.kind === "ValidationError" ? 422 : 400 },
      );
    }
    return redirect(`/?folder=${rawId}`);
  }

  if (intent === "delete-folder") {
    const rawId = String(form.get("folderId") ?? "").trim();
    if (!rawId) return json({ error: "Invalid delete request." }, { status: 400 });
    const r = await deleteFolder(
      { folders: folderRepo(), reports: deps().reports },
      { orgId: actor.value.orgId },
      { folderId: folderId(rawId) },
    );
    if (!r.ok) {
      return json(
        { error: r.error.message },
        { status: r.error.kind === "ValidationError" ? 422 : 400 },
      );
    }
    return redirect("/");
  }

  // new-folder (default): nest under the selected folder.
  const name = String(form.get("name") ?? "");
  const rawParent = String(form.get("parentId") ?? "").trim();
  if (!rawParent) return json({ error: "Select a folder to create in." }, { status: 400 });
  const parentId = folderId(rawParent); // createFolder validates it's in the actor's org

  const r = await createFolder(
    { folders: folderRepo(), ids: deps().ids },
    { orgId: actor.value.orgId },
    { parentId, name },
  );
  if (!r.ok) {
    return json(
      { error: r.error.message },
      { status: r.error.kind === "ValidationError" ? 422 : 400 },
    );
  }
  return redirect(`/?folder=${parentId}`);
}

export default function Index() {
  const { folders, items, total, page, pageSize, q, selectedFolderId, rootId, viewBase } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const childrenOf = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  const root = folders.find((f) => f.parentId === null);
  const folderName = (id: string) => folders.find((f) => f.id === id)?.name ?? "—";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const createParent = selectedFolderId ?? rootId;
  const scopeLabel = selectedFolderId ? folderName(selectedFolderId) : "All reports";

  // Page links preserve the active search + folder filter.
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (selectedFolderId) sp.set("folder", selectedFolderId);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <PageShell>
      <AppHeader
        title="Your reports"
        actions={
          <>
            <Link to="/upload" className={buttonClass("primary")}>
              Upload a report
            </Link>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </>
        }
      />

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
            {q ? ` · matching “${q}”` : ""} · {total} report{total === 1 ? "" : "s"}
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
            <ul className="divide-y divide-border">
              {items.map((r) => (
                <li key={r.slug} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <a
                      href={`${viewBase}/${r.slug}`}
                      className="font-medium text-fg hover:text-brand"
                    >
                      {r.title}
                    </a>{" "}
                    <code className="font-mono text-xs text-subtle">{r.slug}</code>{" "}
                    <span className="text-xs text-subtle">📁 {folderName(r.folderId)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge isPublished={r.isPublished} />
                    <Form method="post" className="flex items-center gap-1">
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <Select
                        name="toFolderId"
                        defaultValue={r.folderId}
                        aria-label={`Move ${r.title} to folder`}
                        className="h-7 text-xs"
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
                    <Form method="post" className="flex items-center gap-1">
                      <input type="hidden" name="intent" value="rename-report" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <input type="hidden" name="folder" value={r.folderId} />
                      <Input
                        name="title"
                        defaultValue={r.title}
                        aria-label={`Rename ${r.title}`}
                        className="h-7 w-32 text-xs"
                      />
                      <Button type="submit" size="sm">
                        Rename
                      </Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-report" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <input type="hidden" name="folder" value={r.folderId} />
                      <Button type="submit" size="sm" variant="danger">
                        Delete
                      </Button>
                    </Form>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center gap-3 text-sm">
              {page > 1 ? (
                <Link to={pageHref(page - 1)} className="text-brand hover:text-brand-hover">
                  ← Prev
                </Link>
              ) : (
                <span className="text-subtle">← Prev</span>
              )}
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link to={pageHref(page + 1)} className="text-brand hover:text-brand-hover">
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
