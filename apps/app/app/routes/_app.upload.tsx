// Upload screen (#337, report Z0W60dI8hu §03). Drop zone first, with the
// raw-HTML paste path RETAINED behind a disclosure (the MCP and CLI already
// produce HTML, ADR-003). Destination folder is chosen at upload time; the title
// defaults to the document's own <title>. This drives the real UploadReportUseCase
// against Neon + R2 (composition root in ../server/container.server) — paste or
// drop HTML → it's stored as a report → view it at the canonical view.<domain>/<slug>.
// The production API is POST /api/v1/reports (ADR-0037); this is the interactive
// surface. Presentation + client wiring only: the upload use case, scan pipeline
// (ADR-0045) and size limits (ADR-0012) are unchanged.
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { uploadReport } from "arp-application";
import { makeFolderId, visibleFolderOrRoot } from "arp-domain";
import { Banner, Card, InfoIcon } from "arp-ui";
import { PageShell } from "../components";
import { type UploadFolderOption, UploadForm } from "../components/upload/UploadForm";
import { deriveTitleFromHtml } from "../components/upload/upload-title";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, ops, viewOrigin } from "../server/container.server";
import { visibleFolderTree } from "../server/folder-sharing.server";
import { errorToJson } from "../server/http.server";

export const meta: MetaFunction = () => [{ title: "Upload a report — Centaur" }];

// The destination-folder picker's options: the actor's VISIBLE folder tree
// (ADR-0076) — the same set the dashboard's Move control offers — root first.
export async function loader(args: LoaderFunctionArgs) {
  const actorR = await resolveActorForRead(args);
  const actor = actorR.ok ? actorR.value : null;
  let folders: UploadFolderOption[] = [];
  let defaultFolderId = "";
  if (actor) {
    const foldersR = await ops().listFolders({ orgId: actor.orgId, userId: actor.userId }, {});
    if (foldersR.ok) {
      const tree = visibleFolderTree(foldersR.value.items);
      const root = tree.find((n) => n.parentId === null);
      defaultFolderId = root?.id ?? "";
      folders = tree.map((n) => ({ id: n.id, name: n.name }));
    }
  }
  return json({ folders, defaultFolderId });
}

export async function action(args: ActionFunctionArgs) {
  const { request } = args;
  const form = await request.formData();
  const html = String(form.get("html") ?? "");
  const titleField = String(form.get("title") ?? "").trim();
  const folderIdField = String(form.get("folderId") ?? "").trim();
  if (!html.trim()) return json({ error: "Drop or paste some HTML to upload." }, { status: 400 });

  // Require a signed-in session (ADR-0048); send anonymous visitors to sign-in.
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    // Any other actor-resolution failure (e.g. Clerk org provisioning) routes
    // through the same problemFor/errorToHttp status authority the JSON API
    // uses — Unexpected's message is already masked behind a generic detail.
    return errorToJson(actor.error);
  }

  // Destination folder (report §03). Clamp the submitted folder to the actor's
  // VISIBLE tree — the same set the picker offered — so a tampered id can only
  // fall back to Root, never target a folder this user cannot see (mirrors the
  // dashboard Move control's validation). No folder chosen ⇒ keep the actor's
  // Root default. This is the ONLY seam the destination flows through: the
  // UploadReportUseCase places a fresh report in `actor.folderId` (Phase-1 Root
  // by default) and is otherwise unchanged.
  let uploadActor = actor.value;
  if (folderIdField) {
    const foldersR = await ops().listFolders(
      { orgId: actor.value.orgId, userId: actor.value.userId },
      {},
    );
    if (foldersR.ok) {
      const tree = visibleFolderTree(foldersR.value.items);
      const root = tree.find((n) => n.parentId === null);
      if (root) {
        const decoded = makeFolderId(visibleFolderOrRoot(folderIdField, tree, root.id));
        if (decoded.ok) uploadActor = { ...actor.value, folderId: decoded.value };
      }
    }
  }

  // Title defaults to the document's own <title> when the field is left blank
  // (works with JS off — the client prefills the same field). The use case still
  // falls back to "Untitled report" when there is no derivable title.
  const title = titleField || deriveTitleFromHtml(html);

  const result = await uploadReport(deps(), {
    actor: uploadActor,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(html) },
    title,
  });
  if (!result.ok) return errorToJson(result.error);
  const out = result.value;
  const { slug, version, scanStatus } = out.result;

  // The version is committed as `pending`; the async scan drain (ADR-0045)
  // promotes it once it scans clean. The viewer shows the "scanning…" holding
  // page until then — no synchronous promotion here. The link points at the
  // canonical view origin (ADR-002 / ADR-0038): view.<domain>/<slug>, via the
  // composition root's viewOrigin() (request-origin fallback on previews/dev).
  const viewUrl = `${viewOrigin(request)}/${slug}`;
  return json({ ok: true as const, slug, version, scanStatus, viewUrl });
}

export default function Upload() {
  const { folders, defaultFolderId } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  return (
    <PageShell className="max-w-3xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold text-fg">Upload a report</h1>
        <p className="mt-1 text-sm text-muted">
          A self-contained HTML document. We scan it, publish a clean version, and give you a link.
        </p>
      </header>
      <Banner
        tone="info"
        icon={<InfoIcon />}
        title="Reports uploaded through the MCP land in Root."
        className="mb-6 max-w-xl"
      >
        Move them into a folder from the reports list anytime, or choose one below.
      </Banner>
      <UploadForm folders={folders} defaultFolderId={defaultFolderId} busy={busy} />
      {data && "error" in data && data.error ? (
        <Card className="mt-5 max-w-xl p-4 text-sm text-danger" role="alert">
          ✗ {data.error}
        </Card>
      ) : null}
      {data && "ok" in data && data.ok ? (
        <Card className="mt-5 max-w-xl p-4 text-sm text-fg" role="status" aria-live="polite">
          ✓ Uploaded as <code className="font-mono text-xs">{data.slug}</code> (v{data.version},
          scan: {data.scanStatus}) —{" "}
          <a href={data.viewUrl} className="text-brand hover:text-brand-hover">
            view it →
          </a>
        </Card>
      ) : null}
    </PageShell>
  );
}
