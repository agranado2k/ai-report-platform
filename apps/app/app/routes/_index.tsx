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
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, folderRepo, viewOrigin } from "../server/container.server";

export const meta: MetaFunction = () => [
  { title: "Your reports — ai-report-platform" },
  { name: "description", content: "Dashboard: your reports, organised in folders." },
];

/** Client-safe folder shape (no org id / timestamps). */
interface FolderNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 920,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Your reports</h1>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </header>

      <p>
        <Link to="/upload">Upload a report →</Link>
      </p>

      {/* Search (GET) — org-wide; preserves the folder filter when set. */}
      <Form method="get" style={{ margin: "8px 0 16px" }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search reports by title or slug…"
          aria-label="Search reports"
          style={{ padding: 6, width: 280 }}
        />
        {selectedFolderId ? <input type="hidden" name="folder" value={selectedFolderId} /> : null}
        <button type="submit" style={{ padding: "6px 12px", marginLeft: 6 }}>
          Search
        </button>
        {q ? (
          <Link
            to={selectedFolderId ? `/?folder=${selectedFolderId}` : "/"}
            style={{ marginLeft: 8, fontSize: 13 }}
          >
            Clear
          </Link>
        ) : null}
      </Form>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Sidebar: folder tree (clicking a folder filters the list). */}
        <nav style={{ width: 220, flexShrink: 0, borderRight: "1px solid #eee", paddingRight: 12 }}>
          <Link
            to="/"
            style={{
              display: "block",
              padding: "4px 6px",
              borderRadius: 4,
              textDecoration: "none",
              color: "#333",
              fontWeight: selectedFolderId ? 400 : 600,
              background: selectedFolderId ? "transparent" : "#eef",
            }}
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
            <p style={{ color: "#999", fontSize: 13 }}>No folders yet.</p>
          )}
        </nav>

        {/* Contents: the paged report list + pagination + new-folder form. */}
        <section style={{ flex: 1 }}>
          <p style={{ color: "#666", margin: "0 0 8px" }}>
            <strong>{scopeLabel}</strong>
            {q ? ` · matching “${q}”` : ""} · {total} report{total === 1 ? "" : "s"}
          </p>
          {items.length === 0 ? (
            <p style={{ color: "#666" }}>{q ? "No matching reports." : "No reports here yet."}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {items.map((r) => (
                <li
                  key={r.slug}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <span>
                    <a href={`${viewBase}/${r.slug}`}>{r.title}</a>{" "}
                    <code style={{ fontSize: 12, color: "#999" }}>{r.slug}</code>{" "}
                    <span style={{ fontSize: 11, color: "#888" }}>📁 {folderName(r.folderId)}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge isPublished={r.isPublished} />
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <select
                        name="toFolderId"
                        defaultValue={r.folderId}
                        aria-label={`Move ${r.title} to folder`}
                        style={{ fontSize: 12 }}
                      >
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" style={{ fontSize: 12, marginLeft: 4 }}>
                        Move
                      </button>
                    </Form>
                    <Form method="post" style={{ display: "inline", marginLeft: 4 }}>
                      <input type="hidden" name="intent" value="rename-report" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <input type="hidden" name="folder" value={r.folderId} />
                      <input
                        name="title"
                        defaultValue={r.title}
                        aria-label={`Rename ${r.title}`}
                        style={{ fontSize: 12, width: 120 }}
                      />
                      <button type="submit" style={{ fontSize: 12, marginLeft: 4 }}>
                        Rename
                      </button>
                    </Form>
                    <Form method="post" style={{ display: "inline", marginLeft: 4 }}>
                      <input type="hidden" name="intent" value="delete-report" />
                      <input type="hidden" name="slug" value={r.slug} />
                      <input type="hidden" name="folder" value={r.folderId} />
                      <button type="submit" style={{ fontSize: 12, color: "#b00" }}>
                        Delete
                      </button>
                    </Form>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              {page > 1 ? (
                <Link to={pageHref(page - 1)}>← Prev</Link>
              ) : (
                <span style={{ color: "#ccc" }}>← Prev</span>
              )}
              <span style={{ fontSize: 13, color: "#666" }}>
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link to={pageHref(page + 1)}>Next →</Link>
              ) : (
                <span style={{ color: "#ccc" }}>Next →</span>
              )}
            </div>
          ) : null}

          {createParent ? (
            <Form method="post" style={{ marginTop: 16 }}>
              <input type="hidden" name="parentId" value={createParent} />
              <input
                name="name"
                placeholder={
                  selectedFolderId ? `New folder in ${scopeLabel}` : "New folder (in Root)"
                }
                required
                style={{ padding: 6, marginRight: 8 }}
              />
              <button type="submit" style={{ padding: "6px 12px" }}>
                + New folder
              </button>
              {actionData && "error" in actionData && actionData.error ? (
                <span style={{ color: "crimson", marginLeft: 8 }}>✗ {actionData.error}</span>
              ) : null}
            </Form>
          ) : null}
        </section>
      </div>
    </main>
  );
}

/** Recursively render a folder and its children as an indented, selectable tree. */
function FolderTree({
  node,
  childrenOf,
  selectedId,
  depth,
}: {
  node: FolderNode;
  childrenOf: (parentId: string | null) => FolderNode[];
  selectedId: string | null;
  depth: number;
}) {
  const selected = node.id === selectedId;
  return (
    <div>
      <Link
        to={`/?folder=${node.id}`}
        style={{
          display: "block",
          padding: "4px 6px",
          paddingLeft: 6 + depth * 14,
          textDecoration: "none",
          borderRadius: 4,
          fontWeight: selected ? 600 : 400,
          background: selected ? "#eef" : "transparent",
          color: "#333",
        }}
      >
        📁 {node.name}
      </Link>
      {selected && node.parentId !== null ? (
        <div
          style={{
            paddingLeft: 6 + depth * 14,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            margin: "2px 0 6px",
          }}
        >
          <Form method="post" style={{ display: "flex", gap: 4 }}>
            <input type="hidden" name="intent" value="rename-folder" />
            <input type="hidden" name="folderId" value={node.id} />
            <input
              name="name"
              defaultValue={node.name}
              aria-label={`Rename ${node.name}`}
              style={{ fontSize: 12, width: 110 }}
            />
            <button type="submit" style={{ fontSize: 12 }}>
              Rename
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="delete-folder" />
            <input type="hidden" name="folderId" value={node.id} />
            <button type="submit" style={{ fontSize: 12, color: "#b00" }}>
              Delete (must be empty)
            </button>
          </Form>
        </div>
      ) : null}
      {childrenOf(node.id).map((child) => (
        <FolderTree
          key={child.id}
          node={child}
          childrenOf={childrenOf}
          selectedId={selectedId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

/**
 * Published = a clean version is live; otherwise it's still being processed.
 * "processing" (not "pending") avoids colliding with the `scan_status` "pending"
 * vocabulary in the glossary — this badge reflects publish state, not scan state.
 */
function StatusBadge({ isPublished }: { isPublished: boolean }) {
  return (
    <span style={{ fontSize: 13, color: isPublished ? "#0a7" : "#999" }}>
      {isPublished ? "published" : "processing"}
    </span>
  );
}
