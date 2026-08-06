/**
 * The editor's OPEN-TIME PRECONDITION, run as a question instead of as an
 * attempt (ADR-0080).
 *
 * Opening a report in the editor requires two things of the stored bytes, in
 * this order: the presentation shell must split off the editable body
 * (`splitShell`, ADR-0062 §2), and — when there is no `_source.json` sidecar to
 * load instead — that body must parse into the `reportSchema`
 * (`parseBody`). Uploads are stored VERBATIM (`HtmlBundleProcessor`) and the
 * viewer just streams them, so a document that fails either leg still VIEWS
 * perfectly: "views fine, won't edit" is a real state, not an impossible one.
 *
 * This function is the ONE place that state is named, and it names it by
 * CALLING the same two functions the editor calls — never by re-deriving their
 * conditions. A second implementation ("does it contain `<body`?") would drift
 * from the real predicate the first time either function changed, which is
 * precisely the bug class ADR-0080 exists to close. Same reasoning as
 * `isDangerousUrl`, exported so the link-activation gate can reuse the schema's
 * own predicate rather than growing a copy of it.
 *
 * COST: the `unparsable` leg runs a full linkedom + ProseMirror parse of the
 * document. That is the price of asking the real question; callers on a hot
 * path should record the answer rather than re-ask it.
 */

import { parseBody } from "./body.js";
import { splitShell } from "./shell.js";

/**
 * The verdict. `editable` = the editor can open these bytes. `unsplittable` =
 * no usable `<body>` boundary (a fragment, an unclosed body, a `</body>` ahead
 * of its opening tag). `unparsable` = the shell splits but the body defeats the
 * schema parser — the `document-unparsable` degrade on the read path.
 */
export type Editability = "editable" | "unsplittable" | "unparsable";

/**
 * Answer whether the editor could open `html`, without opening it.
 *
 * `hasSourceDoc` mirrors the editor's own branch: when a version carries a
 * `_source.json` sidecar (every editor-authored save, ADR-0062 §4) the loader
 * uses it and never calls `parseBody`, so the parse leg cannot stop it.
 * Defaults to `false` — the uploaded-never-edited case, which is every report
 * an agent publishes.
 */
export function probeEditability(html: string, hasSourceDoc = false): Editability {
  let bodyHtml: string;
  try {
    ({ bodyHtml } = splitShell(html));
  } catch {
    return "unsplittable";
  }
  if (hasSourceDoc) return "editable";
  try {
    // Deliberately catches THROWN values of every kind, not just Error: this
    // leg's realistic failure is a RangeError from ProseMirror's recursive
    // descent, and a probe whose whole contract is "never throw, always answer"
    // must not itself become a new crash site.
    parseBody(bodyHtml);
  } catch {
    return "unparsable";
  }
  return "editable";
}
