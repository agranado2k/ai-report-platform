/**
 * "Report HTML" schema package (ADR-0062) — the ProseMirror document schema
 * and shell/body split for editing a Centaur report.
 */

export type { PMDocJson } from "./body.js";
export { parseBody, serializeBody } from "./body.js";
export { reportSchema } from "./schema.js";
export type { Shell, SplitShellResult } from "./shell.js";
export { reinjectShell, splitShell } from "./shell.js";
