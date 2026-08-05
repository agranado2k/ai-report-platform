// Builds the harness page consumed by tests/browser/*.spec.ts (ADR-0079).
//
// THE PANE GEOMETRY IN THE <style> BELOW IS A HAND COPY of apps/view's
// `/edit` route (`apps/view/app/routes/$slug_.edit.tsx`): a 53px topbar, a
// flexed document pane, a 320px (`w-80`) side panel. Nothing links the two, so
// a layout change there must be mirrored here in the same PR — a matching
// comment sits on the route. The editing surface's height falls out of this
// layout, and the anchor assertions are stated in terms of it.
//
// `box-sizing: border-box` ON THE TOPBAR IS LOAD-BEARING, and its absence was
// a silent 17px fidelity bug. The route's topbar is 53px TOTAL (Tailwind
// `py-3` + a `border-b` around an `sm` button); this stylesheet wrote
// `height: 53px` plus 8px of padding and a 1px border under the default
// content-box sizing, making it 70px and the editing surface 630px tall. The
// route's surface is 700 - 53 = 647px — which is exactly the viewport height
// the operator read off the real page when reporting the anchor failure. Every
// geometric number in the specs is derived at runtime rather than hard-coded,
// so this did not fail anything; it just meant the tier had been measuring a
// pane 17px shorter than the one users have.
//
// Bundled with esbuild rather than served by a dev server because the page has
// no server side at all: it is `ReportEditor` plus a report, and the whole
// point is to exercise the mounted editor in a real browser. `resolveDir` is
// apps/view because that is the workspace package which already depends on
// `arp-editor` / `arp-report-html` / react — the harness is deliberately not a
// package of its own, so it can never drift from what the app actually
// resolves.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..", "..", "apps", "view");

/** One generated page PER FIXTURE. A single shared output path would mean two
 *  spec files that build different fixtures overwrite each other's page — and
 *  because the suite runs `workers: 1`, the loser would silently be tested
 *  against the winner's report instead of failing. */
function pageFor(fixture: string): string {
  return join(here, `index.${basename(fixture).replace(/\.html$/, "")}.generated.html`);
}

export async function buildHarness(fixture = "report.html"): Promise<string> {
  const bundle = await esbuild.build({
    stdin: {
      contents: readFileSync(join(here, "entry.tsx"), "utf8"),
      resolveDir: appDir,
      loader: "tsx",
      sourcefile: "entry.tsx",
    },
    absWorkingDir: appDir,
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });

  const js = bundle.outputFiles[0]?.text ?? "";
  const report = readFileSync(join(here, fixture), "utf8");
  const inlineSafe = (s: string) => s.replace(/<\/script>/g, "<\\/script>");

  const page = pageFor(fixture);
  writeFileSync(
    page,
    `<!doctype html>
<html><head><meta charset="utf-8"><title>editor harness</title>
<style>
html,body{margin:0;height:100%;overflow:hidden}
#root{height:100vh}
.root-layout{display:flex;flex-direction:column;height:100%}
.topbar{flex:0 0 auto;box-sizing:border-box;height:53px;border-bottom:1px solid #ccc;font:14px system-ui;padding:8px}
.pane-row{display:flex;flex:1 1 auto;min-height:0}
.doc-pane{min-width:0;flex:1 1 auto;overflow:hidden}
.editor-slot{height:100%}
.side-panel{flex:0 0 320px;border-left:1px solid #ccc;font:14px system-ui}
.editor-iframe{width:100%;height:100%;border:0}
</style></head><body>
<div id="root"></div>
<script type="text/plain" id="report-src">${inlineSafe(report)}</script>
<script>${inlineSafe(js)}</script>
</body></html>`,
  );

  return page;
}
