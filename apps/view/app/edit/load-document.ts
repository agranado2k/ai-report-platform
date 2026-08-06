// loadEditableDocument — read the live version's entry document out of the
// blob store and turn it into the two things the editor needs: the opaque
// presentation shell and the ProseMirror doc (ADR-0062 §2/§4).
//
// Extracted from `$slug_.edit.tsx`'s loader by the 2026-08-06 owner-lockout
// fix. This is the LAST place a fully-authorized owner can be turned away
// from their own /edit route: the gate has already accepted their capability
// and resolved a clean live version, so anything that fails here fails on the
// DOCUMENT, not on access. Three things can: the blob read, the shell split
// and the ProseMirror parse — each one a named `reason`, none of them able to
// throw. It used to be inline, untested, silent, and
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
import type { EditDegradeReason } from "../server/gate.server";

/** Why the editor could not open a document the gate had already cleared.
 *
 *  Derived from `EditDegradeReason` rather than restated, so the two unions
 *  cannot drift: the caller logs these THROUGH `editDegradeLine`, and a reason
 *  this module can return but that enum doesn't know about would not typecheck
 *  at the call site — which is exactly the coupling we want made explicit.
 *
 *  - `document-unreadable`  — absent from the blob store, or the read failed.
 *  - `document-unsplittable` — not a splittable HTML document (no/unclosed `<body>`).
 *  - `document-unparsable`  — the body HTML defeats the ProseMirror parse. */
export type DocumentDegradeReason = Extract<
  EditDegradeReason,
  "document-unreadable" | "document-unsplittable" | "document-unparsable"
>;

export type DocumentLoad =
  | { readonly kind: "loaded"; readonly doc: PMDocJson; readonly shell: Shell }
  | { readonly kind: "degraded"; readonly reason: DocumentDegradeReason };

export interface LoadEditableDocumentArgs {
  readonly blobs: BlobStore;
  readonly reportId: ReportId;
  readonly versionId: VersionId;
  readonly entryDocument: string;
  /** The report's slug — carried ONLY so the sidecar warning keys on the same
   *  field every other view-origin event does, and can therefore be correlated
   *  with the degrade line emitted for the same request. */
  readonly slug: string;
  /** Structured-log sink; defaults to `console.warn` (Vercel captures it —
   *  the view origin has no logger of its own, ADR-0038). */
  readonly warn?: (line: string) => void;
}

/** Does this parsed sidecar even claim to be a ProseMirror doc? `JSON.parse`
 *  returns `null`, `[]`, `42` and `{}` without complaint, and all four used to
 *  sail through the try/catch below as a `PMDocJson` — only to throw in
 *  `PMNode.fromJSON` at MOUNT, client-side, long past every degrade this module
 *  can offer. Same posture `computeReportDiff` takes on the same bytes. */
function isPMDoc(parsed: unknown): parsed is PMDocJson {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    (parsed as { type?: unknown }).type === "doc"
  );
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
    const parsed = parseJson(new TextDecoder().decode(sidecar.value.bytes));
    if (isPMDoc(parsed)) return { kind: "loaded", shell, doc: parsed };
    warn(JSON.stringify({ event: "edit-source-sidecar-unparsable", slug: args.slug, versionId }));
  }

  // THE LAST UNGUARDED CALL (review #247 H-4). `parseBody` runs the report body
  // through linkedom + ProseMirror's RECURSIVE DOM parse, and both can throw —
  // a deeply nested document overflows the stack outright. It is also the line
  // every report with no `_source.json` takes, i.e. every uploaded-never-edited
  // report: precisely the profile of the report that caused the incident. In a
  // function whose entire contract is "never crash, always name the reason", it
  // was the one place that could still 500.
  try {
    return { kind: "loaded", shell, doc: parseBody(bodyHtml) };
  } catch {
    return { kind: "degraded", reason: "document-unparsable" };
  }
}

/** `JSON.parse` that yields `undefined` instead of throwing. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
