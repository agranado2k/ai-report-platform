// loadEditableDocument — read the live version's entry document out of the
// blob store and turn it into the two things the editor needs: the opaque
// presentation shell and the ProseMirror doc (ADR-0062 §2/§4).
//
// Extracted from `$slug_.edit.tsx`'s loader by the 2026-08-06 owner-lockout
// fix. This is the LAST place a fully-authorized owner can be turned away
// from their own /edit route: the gate has already accepted their capability
// and resolved a clean live version, so anything that fails here fails on the
// DOCUMENT, not on access. It used to be inline, untested, silent, and
// hard-coded to degrade to the bare public viewer — which unlock-walls (and
// 403s) a private report's owner. Now every failure is a named reason the
// caller logs and can act on, and the caller degrades through the owner's
// `?access=` fallback (Decision.degradeTo).
//
// Note the asymmetry this closes with the read-only viewer: `GET /<slug>`
// streams whatever bytes were uploaded, so a document the editor cannot open
// (an HTML fragment with no `<body>` — the upload pipeline stores uploads
// VERBATIM, see HtmlBundleProcessor) still VIEWS perfectly. "Views fine, won't
// edit" is therefore an expected, reportable state, not an impossible one.
import type { BlobStore } from "arp-application";
import type { ReportId, VersionId } from "arp-domain";
import { type PMDocJson, parseBody, type Shell, splitShell } from "arp-report-html";

/** Why the editor could not open a document the gate had already cleared. */
export type DocumentDegradeReason =
  /** The entry document is absent from the blob store, or the read failed. */
  | "document-unreadable"
  /** The bytes are not a splittable HTML document (no/unclosed `<body>`). */
  | "document-unsplittable";

export type DocumentLoad =
  | { readonly kind: "loaded"; readonly doc: PMDocJson; readonly shell: Shell }
  | { readonly kind: "degraded"; readonly reason: DocumentDegradeReason };

export interface LoadEditableDocumentArgs {
  readonly blobs: BlobStore;
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly entryDocument: string;
  /** Structured-log sink; defaults to `console.warn` (Vercel captures it —
   *  the view origin has no logger of its own, ADR-0038). */
  readonly warn?: (line: string) => void;
}

export async function loadEditableDocument(args: LoadEditableDocumentArgs): Promise<DocumentLoad> {
  const { blobs, reportId, versionId, entryDocument } = args;
  const warn = args.warn ?? console.warn;

  const blob = await blobs.readObject(reportId, versionId, entryDocument);
  if (!blob.ok || !blob.value) return { kind: "degraded", reason: "document-unreadable" };

  let shell: Shell;
  let bodyHtml: string;
  try {
    ({ shell, bodyHtml } = splitShell(new TextDecoder().decode(blob.value.bytes)));
  } catch {
    return { kind: "degraded", reason: "document-unsplittable" };
  }

  // Lossless reopen when a prior editor save left a `_source.json` sidecar;
  // otherwise a best-effort HTML→PM parse (ADR-0062 §4). A CORRUPT sidecar
  // used to be an uncaught JSON.parse — a 500 on a report the editor could
  // have opened by re-parsing the body. Fall back, and say so.
  const sidecar = await blobs.readObject(reportId, versionId, "_source.json");
  if (sidecar.ok && sidecar.value) {
    try {
      return {
        kind: "loaded",
        shell,
        doc: JSON.parse(new TextDecoder().decode(sidecar.value.bytes)) as PMDocJson,
      };
    } catch {
      warn(JSON.stringify({ event: "edit-source-sidecar-unparsable", versionId }));
    }
  }
  return { kind: "loaded", shell, doc: parseBody(bodyHtml) };
}
