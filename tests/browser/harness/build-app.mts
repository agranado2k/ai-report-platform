// Builds harness pages that mount PRODUCTION `apps/app` components (ADR-0079,
// app-component amendment, #403). The editor harness beside it (build.mts)
// bundles against apps/view with a hand-written pane stylesheet; this one
// bundles against apps/app and inlines the app's REAL compiled stylesheet —
// `apps/app/app/tailwind.css` run through the same `@tailwindcss/vite` plugin
// the app's own Vite build uses, scanning the same sources. A hand-copied
// layout cannot certify responsiveness, so there is none here: every class the
// specs measure is the one the app ships.
//
// Still hermetic: no server, no Remix runtime, no Clerk, no network. The entry
// mounts the components under a react-router MEMORY data router (the same
// react-router-dom instance @remix-run/react wraps), which is all Remix's
// `Link`/`Form`/`useFetcher` need on the client.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..", "..", "apps", "app");
const requireFromApp = createRequire(join(appDir, "package.json"));

/** The react-router-dom @remix-run/react itself resolves — aliased so the
 *  entry's memory router and Remix's hooks share one router context. */
function reactRouterDomDir(): string {
  const requireFromRemix = createRequire(requireFromApp.resolve("@remix-run/react"));
  return dirname(requireFromRemix.resolve("react-router-dom/package.json"));
}

let cssOnce: Promise<string> | undefined;

/** The app's compiled stylesheet, built once per worker. Font URLs are
 *  root-absolute in the app (served from its origin); over `file://` they are
 *  pointed at the same woff2 files in apps/app/public so text metrics match. */
function compiledAppCss(): Promise<string> {
  cssOnce ??= (async () => {
    const viteDir = dirname(requireFromApp.resolve("vite/package.json"));
    const vite = (await import(
      pathToFileURL(join(viteDir, "dist", "node", "index.js")).href
    )) as typeof import("vite");
    const tailwind = (await import(pathToFileURL(requireFromApp.resolve("@tailwindcss/vite")).href))
      .default as () => import("vite").PluginOption;
    const out = await vite.build({
      configFile: false,
      root: appDir,
      logLevel: "error",
      plugins: [tailwind()],
      build: { write: false, rollupOptions: { input: join(appDir, "app", "tailwind.css") } },
    });
    const outputs = (Array.isArray(out) ? out : [out]) as import("rollup").RollupOutput[];
    const css = outputs
      .flatMap((o) => o.output)
      .find((f) => f.type === "asset" && f.fileName.endsWith(".css"));
    if (css?.type !== "asset") throw new Error("vite produced no stylesheet for the app");
    const publicDir = pathToFileURL(join(appDir, "public")).href;
    return String(css.source).replace(/url\((["']?)\/fonts\//g, `url($1${publicDir}/fonts/`);
  })();
  return cssOnce;
}

/** Bundles `entry` (a file beside this one) with the app's resolution and the
 *  app's compiled CSS into a self-contained page; returns its path. */
export async function buildAppHarness(entry: string): Promise<string> {
  const [bundle, css] = await Promise.all([
    esbuild.build({
      // stdin with `resolveDir` = apps/app, like build.mts does for apps/view:
      // the entry imports `./app/components/...` and every bare specifier
      // resolves exactly as the app's own build resolves it.
      stdin: {
        contents: readFileSync(join(here, entry), "utf8"),
        resolveDir: appDir,
        loader: "tsx",
        sourcefile: entry,
      },
      absWorkingDir: appDir,
      alias: { "react-router-dom": reactRouterDomDir() },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    }),
    compiledAppCss(),
  ]);

  const js = bundle.outputFiles[0]?.text ?? "";
  const inlineSafe = (s: string) => s.replace(/<\/(script|style)>/gi, "<\\/$1>");
  const page = join(here, `index.${basename(entry).replace(/\.tsx$/, "")}.app.generated.html`);
  writeFileSync(
    page,
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>app harness</title>
<style>${inlineSafe(css)}</style>
</head><body>
<div id="root"></div>
<script>${inlineSafe(js)}</script>
</body></html>`,
  );
  return page;
}
