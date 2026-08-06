/**
 * "Report HTML" schema package (ADR-0062) — the ProseMirror document schema
 * and shell/body split for editing a Centaur report.
 */

export type { PMDocJson } from "./body.js";
export { parseBody, serializeBody } from "./body.js";
export type { ChangeRange, DocDiff } from "./diff.js";
export { diffDocs, diffRendered } from "./diff.js";
// Version-history visual diff (ADR-0065 §3/§4).
export { DIFF_DEL_CLASS, DIFF_INS_CLASS } from "./diff-schema.js";
// The editor's own open-time precondition, exposed as a QUESTION so the upload
// path can record the answer instead of the user discovering it (ADR-0080).
export type { Editability } from "./editability.js";
export { probeEditability } from "./editability.js";
export type { HtmlFallbackDiff } from "./html-fallback.js";
export {
  diffHtmlFallback,
  FALLBACK_DEL_CLASS,
  FALLBACK_INS_CLASS,
  STRUCTURAL_DIFF_UNAVAILABLE_LABEL,
} from "./html-fallback.js";
// Exported so the editor's link-activation gate can reuse the SAME
// dangerous-URL predicate the schema enforces at parse/serialize time
// (ADR-0062 Amendment 3), rather than growing a second copy of it.
export { isDangerousUrl } from "./schema/attrs.js";
export {
  normalizeLinkRel,
  normalizeLinkTarget,
} from "./schema/link.js";
export { reportSchema } from "./schema.js";
export type { Shell, SplitShellResult } from "./shell.js";
export { reinjectShell, splitShell } from "./shell.js";
