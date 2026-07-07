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
import { loadWritableReport, saveEditedVersion } from "arp-application";
import type { ReportVersion } from "arp-domain";
import { makeSlug } from "arp-domain";
import {
  type PMDocJson,
  parseBody,
  reinjectShell,
  serializeBody,
  splitShell,
} from "arp-report-html";
import { useRef, useState } from "react";
import { AppHeader, Button, buttonClass, Card, PageShell } from "../components";
import { ReportEditor } from "../components/ReportEditor";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { deps, identityStore, writeGrantStore } from "../server/container.server";
import { errorToJson, rejectNonJsonContentType } from "../server/http.server";

/** The version an editor session opens: the live version when one has been
 *  published, else the newest by `version_no` (a fresh upload that hasn't
 *  cleared scan yet still needs to be openable/editable, ADR-0062 §5). */
function editableVersion(report: {
  readonly liveVersionId: string | null;
  readonly versions: readonly ReportVersion[];
}) {
  const newest = [...report.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
  if (!report.liveVersionId) return newest;
  return report.versions.find((v) => v.id === report.liveVersionId) ?? newest;
}

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
  const { bodyHtml } = splitShell(html);

  const sidecar = await deps().blobs.readObject(report.id, version.id, "_source.json");
  // Lossless reopen when a prior editor save left a sidecar; otherwise a
  // best-effort HTML→PM parse (ADR-0062 §4) — the first edit of a report
  // that has only ever been uploaded.
  const doc: PMDocJson =
    sidecar.ok && sidecar.value
      ? (JSON.parse(new TextDecoder().decode(sidecar.value.bytes)) as PMDocJson)
      : parseBody(bodyHtml);

  return json({ slug: report.slug, title: report.title, doc, versionNo: version.versionNo });
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

  // Re-read fresh (not the loader's snapshot) so the shell we re-inject comes
  // from the CURRENT editable version, and so a non-owner's POST is denied
  // even if they somehow reached this action directly (loadWritableReport =
  // the exact canWrite gate re-upload uses).
  const found = await loadWritableReport(deps().reports, actor.value, slugR.value, {
    grants: writeGrantStore(),
    identities: identityStore(),
  });
  if (!found.ok) return errorToJson(found.error);
  const report = found.value;
  const version = editableVersion(report);
  if (!version) return errorToJson({ kind: "NotFound", message: "report has no version" });

  const htmlBlob = await deps().blobs.readObject(
    report.id,
    version.id,
    version.manifest.entryDocument,
  );
  if (!htmlBlob.ok || !htmlBlob.value) {
    return errorToJson({ kind: "Unexpected", message: "editable version's HTML is missing" });
  }
  const { shell } = splitShell(new TextDecoder().decode(htmlBlob.value.bytes));

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

  const bodyHtml = serializeBody(doc);
  const wholeHtml = reinjectShell(shell, bodyHtml);

  const saved = await saveEditedVersion(deps(), {
    actor: actor.value,
    slug: slugR.value,
    html: new TextEncoder().encode(wholeHtml),
    sourceDoc: doc,
  });
  if (!saved.ok) return errorToJson(saved.error);

  return json({ ok: true as const, ...saved.value.result });
}

export default function EditReport() {
  const { slug, title, doc, versionNo } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const docRef = useRef<PMDocJson>(doc as PMDocJson);
  const [dirty, setDirty] = useState(false);

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

  return (
    <PageShell className="max-w-4xl">
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
      <Card className="p-6">
        <ReportEditor
          key={slug}
          initialDoc={doc as PMDocJson}
          onChange={(next) => {
            docRef.current = next;
            setDirty(true);
          }}
          className="report-editor prose min-h-[24rem] focus:outline-none"
        />
      </Card>
    </PageShell>
  );
}
