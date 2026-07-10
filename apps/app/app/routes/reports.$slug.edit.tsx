// GET  /reports/{slug}/edit — open the in-dashboard WYSIWYG editor (ADR-0062,
//      ADR-0063: the editor lives on the DASHBOARD origin, app.<domain> — the
//      viewer-origin edit route is a separate, future, security-gated slice;
//      this route never touches apps/view).
// POST /reports/{slug}/edit — save an edit: re-assembles the whole document
//      (presentation shell + edited body, via reinjectShell) and runs it
//      through saveEditedVersion — the exact ADR-0037 upload pipeline, with
//      origin='editor' and the `_source.json` sidecar (ADR-0062 §4/§5).
//
// Auth mirrors re-upload's authorization EXACTLY (ADR-0059 §2 / ADR-0060):
// loadWritableReport's `canWrite` gate — isOwner OR hasWriteGrant (write
// grants landed in PR #150). A caller who can't write is denied on both the
// page load and the save action.
import { type ActionFunctionArgs, json, type LoaderFunctionArgs, redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { listComments, loadWritableReport } from "arp-application";
import { makeSlug, versionIdToWire } from "arp-domain";
import { type EditorSelection, ReportEditor } from "arp-editor";
import { type PMDocJson, parseBody, splitShell } from "arp-report-html";
import { useMemo, useRef, useState } from "react";
import { AppHeader, Button, buttonClass, Card, PageShell } from "../components";
import { CommentSidebar } from "../components/CommentSidebar";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import type { CommentDto } from "../server/comment-dto.server";
import { commentToDto } from "../server/comment-dto.server";
import { commentRepo, deps, identityStore, writeGrantStore } from "../server/container.server";
import { errorToJson, rejectNonJsonContentType } from "../server/http.server";
import {
  editableVersion,
  reassembleAndSaveEditedVersion,
} from "../server/save-edited-version.server";

export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveActorForRead(args);
  if (!actor.ok || !actor.value) return redirect("/sign-in");

  const slugR = makeSlug(String(args.params.slug ?? ""));
  if (!slugR.ok) return redirect("/");

  const found = await loadWritableReport(deps().reports, actor.value, slugR.value, {
    grants: writeGrantStore(),
    identities: identityStore(),
  });
  if (!found.ok) return redirect("/"); // never reveal existence to a non-owner (ADR-0059 §4 posture)
  const report = found.value;

  const version = editableVersion(report);
  if (!version) return redirect("/");

  const htmlBlob = await deps().blobs.readObject(
    report.id,
    version.id,
    version.manifest.entryDocument,
  );
  if (!htmlBlob.ok || !htmlBlob.value) return redirect("/");
  const html = new TextDecoder().decode(htmlBlob.value.bytes);
  // STYLING FIX (Fix 1): `shell` used to be discarded here — the report's
  // own `<style>`/`<body>` attrs never reached the client, so the editor
  // rendered with none of the report's CSS. It's now returned to the client
  // alongside `doc` so ReportEditor can build the sandboxed iframe document
  // from it (apps/app/app/editor/iframe-document.ts).
  const { shell, bodyHtml } = splitShell(html);

  const sidecar = await deps().blobs.readObject(report.id, version.id, "_source.json");
  // Lossless reopen when a prior editor save left a sidecar; otherwise a
  // best-effort HTML→PM parse (ADR-0062 §4) — the first edit of a report
  // that has only ever been uploaded.
  const doc: PMDocJson =
    sidecar.ok && sidecar.value
      ? (JSON.parse(new TextDecoder().decode(sidecar.value.bytes)) as PMDocJson)
      : parseBody(bodyHtml);

  // Comments sidebar (ADR-0064): listed server-side via the SAME listComments
  // use case the /api/v1 route calls — per the task brief, NOT a client-side
  // self-call to our own API. JUDGMENT CALL: fetches the first page only (up
  // to list-comments.ts's MAX_LIMIT=100) — no "load more" pagination UI in
  // this slice. Best-effort: a listComments failure never blocks opening the
  // editor, it just shows an empty sidebar.
  const commentsPage = await listComments(
    { reports: deps().reports, comments: commentRepo() },
    { orgId: actor.value.orgId },
    { slug: slugR.value, limit: 100 },
  );
  const rawComments = commentsPage.ok ? commentsPage.value.items : [];

  // Best-effort author email enrichment (IdentityStore.findEmailByUserId) —
  // one lookup per UNIQUE author, not per comment; a failed/missing lookup
  // just falls back to the raw author id (CommentSidebar's concern).
  const uniqueAuthorIds = [...new Set(rawComments.map((c) => c.authorUserId))];
  const emailEntries = await Promise.all(
    uniqueAuthorIds.map(async (id) => {
      const emailResult = await identityStore().findEmailByUserId(id);
      return [id, emailResult.ok ? emailResult.value : null] as const;
    }),
  );
  const emailByAuthor = new Map(emailEntries);
  const comments: CommentDto[] = rawComments.map((c) =>
    commentToDto(c, emailByAuthor.get(c.authorUserId) ?? null),
  );

  return json({
    slug: report.slug,
    title: report.title,
    doc,
    shell,
    versionNo: version.versionNo,
    versionId: versionIdToWire(version.id),
    comments,
  });
}

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST") {
    return json({ error: "method not allowed" }, { status: 405 });
  }

  // SECURITY (PR #151 review, Fix 4): reject a non-JSON Content-Type with 415
  // before any parsing or auth work — see rejectNonJsonContentType's doc
  // comment in http.server.ts for why (belt-and-braces on top of
  // SameSite=Lax, which is the primary cross-site defense here).
  const contentTypeRejection = rejectNonJsonContentType(args.request);
  if (contentTypeRejection) return contentTypeRejection;

  const actor = await resolveUploadActor(args);
  if (!actor.ok) return errorToJson(actor.error);

  const slugR = makeSlug(String(args.params.slug ?? ""));
  if (!slugR.ok) return errorToJson(slugR.error);

  let doc: PMDocJson;
  try {
    const body = (await args.request.json()) as { doc?: unknown };
    if (!body.doc || typeof body.doc !== "object") {
      return json({ error: "missing 'doc' in request body" }, { status: 422 });
    }
    doc = body.doc as PMDocJson;
  } catch {
    return json({ error: "malformed JSON body" }, { status: 422 });
  }

  // reassembleAndSaveEditedVersion re-reads the report fresh (not the
  // loader's snapshot), re-runs the canWrite gate (loadWritableReport — the
  // exact seam re-upload uses), re-injects the doc into the CURRENT
  // editable version's shell, and saves it via saveEditedVersion. Shared
  // with POST /api/v1/reports/{slug}/versions (the edit-token save route) —
  // ONE reassembly implementation, not two copies that could drift.
  const saved = await reassembleAndSaveEditedVersion(deps(), actor.value, slugR.value, doc);
  if (!saved.ok) return errorToJson(saved.error);

  return json({ ok: true as const, ...saved.value.result });
}

export default function EditReport() {
  const { slug, title, doc, shell, versionNo, versionId, comments } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const docRef = useRef<PMDocJson>(doc as PMDocJson);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  const onSave = () => {
    fetcher.submit(JSON.stringify({ doc: docRef.current }), {
      method: "post",
      encType: "application/json",
    });
    setDirty(false);
  };

  const status =
    fetcher.state !== "idle"
      ? "Saving…"
      : fetcher.data && "ok" in fetcher.data && fetcher.data.ok
        ? `Saved as v${fetcher.data.version} — scan: ${fetcher.data.scanStatus}`
        : fetcher.data && "error" in fetcher.data
          ? `✗ ${fetcher.data.error}`
          : dirty
            ? "Unsaved changes"
            : "";

  // Highlight-decoration input for ReportEditor — only comments that carry a
  // `relative` slot are candidates; resolvableCommentRanges (in ReportEditor)
  // further filters to ones that still fit inside the current doc's bounds.
  const highlightable = useMemo(
    () => comments.map((c) => ({ id: c.id, anchor: { relative: c.anchor.relative } })),
    [comments],
  );

  return (
    <PageShell className="max-w-6xl">
      <AppHeader
        title={`Editing “${title}”`}
        actions={
          <>
            <span className="text-sm text-muted" role="status" aria-live="polite">
              {status}
            </span>
            <Button variant="primary" onClick={onSave} disabled={fetcher.state !== "idle"}>
              Save
            </Button>
            <Link to="/" className={buttonClass("secondary")}>
              ← Back to reports
            </Link>
          </>
        }
      />
      <p className="mb-4 text-xs text-subtle">
        <code className="font-mono">{slug}</code> · editing from v{versionNo}
      </p>
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <Card className="p-6">
          <ReportEditor
            key={slug}
            initialDoc={doc as PMDocJson}
            shell={shell}
            comments={highlightable}
            onChange={(next) => {
              docRef.current = next;
              setDirty(true);
            }}
            onSelectionChange={setSelection}
            className="w-full min-h-[24rem] rounded-card border border-border"
          />
        </Card>
        <CommentSidebar
          slug={slug}
          versionId={versionId}
          comments={comments}
          pendingSelection={selection}
          onSubmittedSelection={() => setSelection(null)}
        />
      </div>
    </PageShell>
  );
}
