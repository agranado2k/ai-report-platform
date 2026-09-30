import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../../..");
const app = resolve(root, "apps/app");
const require = createRequire(resolve(app, "package.json"));

export async function buildDashboard() {
  const { build: viteBuild } = await import(
    resolve(require.resolve("vite/package.json"), "../dist/node/index.js")
  );
  const { default: tailwind } = await import(require.resolve("@tailwindcss/vite"));
  const cssBuild = await viteBuild({
    configFile: false,
    root: app,
    plugins: [tailwind()],
    build: { write: false, rollupOptions: { input: resolve(app, "app/tailwind.css") } },
  });
  const cssOutputs = Array.isArray(cssBuild) ? cssBuild : [cssBuild];
  const css = cssOutputs
    .flatMap((output) => output.output)
    .find((output) => output.type === "asset" && output.fileName.endsWith(".css"));
  if (!css) throw new Error("dashboard harness CSS build produced no stylesheet");
  const js = await build({
    stdin: {
      contents: readFileSync(resolve(root, "tests/browser/harness/entry-dashboard.tsx"), "utf8"),
      resolveDir: resolve(root, "tests/browser/harness"),
      loader: "tsx",
    },
    alias: {
      "arp-ui": resolve(root, "packages/ui/src/index.ts"),
      "react-router-dom": resolve(
        createRequire(require.resolve("@remix-run/react")).resolve("react-router-dom/package.json"),
        "..",
      ),
    },
    nodePaths: [resolve(app, "node_modules")],
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const page = resolve(root, "tests/browser/harness/index.dashboard.generated.html");
  if (!js.outputFiles[0]?.text) throw new Error("dashboard harness JS build produced no bundle");
  writeFileSync(
    page,
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${String(css?.source ?? "")}</style></head><body><div id="root"></div><script>${js.outputFiles[0]?.text.replace(/<\/script>/g, "<\\/script>") ?? ""}</script></body></html>`,
  );
  return page;
}
