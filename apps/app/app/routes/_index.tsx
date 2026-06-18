import { SignedIn, UserButton } from "@clerk/remix";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { createFolder, listReports, moveReport } from "arp-application";
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

// Dashboard (ADR-0036, Reports & Folders): a folder tree + the selected folder's
// reports. resolveActorForRead resolves the org WITHOUT provisioning (GETs stay
// safe). `?folder=<id>` selects a folder; default is the org Root.
export async function loader(args: LoaderFunctionArgs) {
  const viewBase = viewOrigin(args.request);
  const actor = await resolveActorForRead(args);
  if (!actor) return json({ folders: [] as FolderNode[], reports: [], selectedId: null, viewBase });

  const [foldersR, reportsR] = await Promise.all([
    folderRepo().listByOrg(actor.orgId),
    listReports({ reports: deps().reports }, { orgId: actor.orgId }),
  ]);
  if (!foldersR.ok) console.warn(`dashboard: listFolders failed — ${foldersR.error.message}`);
  if (!reportsR.ok) console.warn(`dashboard: listReports failed — ${reportsR.error.message}`);

  const folders: FolderNode[] = (foldersR.ok ? foldersR.value : []).map((f) => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
  }));
  const reports = reportsR.ok ? reportsR.value : [];

  const root = folders.find((f) => f.parentId === null) ?? null;
  const requested = new URL(args.request.url).searchParams.get("folder");
  const selectedId =
    requested && folders.some((f) => f.id === requested) ? requested : (root?.id ?? null);

  return json({ folders, reports, selectedId, viewBase });
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
  const { folders, reports, selectedId, viewBase } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const childrenOf = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  const folderReports = reports.filter((r) => r.folderId === selectedId);
  const root = folders.find((f) => f.parentId === null);

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

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Sidebar: folder tree */}
        <nav style={{ width: 220, flexShrink: 0, borderRight: "1px solid #eee", paddingRight: 12 }}>
          {root ? (
            <FolderTree node={root} childrenOf={childrenOf} selectedId={selectedId} depth={0} />
          ) : (
            <p style={{ color: "#999", fontSize: 13 }}>No folders yet.</p>
          )}
        </nav>

        {/* Contents: the selected folder's reports + new-folder form */}
        <section style={{ flex: 1 }}>
          {folderReports.length === 0 ? (
            <p style={{ color: "#666" }}>This folder is empty.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {folderReports.map((r) => (
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
                    <code style={{ fontSize: 12, color: "#999" }}>{r.slug}</code>
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
                  </span>
                </li>
              ))}
            </ul>
          )}

          {selectedId ? (
            <Form method="post" style={{ marginTop: 16 }}>
              <input type="hidden" name="parentId" value={selectedId} />
              <input
                name="name"
                placeholder="New folder name"
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
