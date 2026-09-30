// The actual /edit component, with only Remix's server loader stripped from
// the browser bundle. A memory router supplies serialized loader data; network
// responses are controlled at the Playwright boundary, never inside the editor.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../../..");
const app = resolve(root, "apps/view");
const require = createRequire(resolve(app, "package.json"));
export async function buildMobileEditor(fixture = "tests/browser/harness/plain-report.html") {
  const { build: viteBuild } = await import(
    resolve(require.resolve("vite/package.json"), "../dist/node/index.js")
  );
  const { default: tailwind } = await import(require.resolve("@tailwindcss/vite"));
  const result = await viteBuild({
    configFile: false,
    root: app,
    plugins: [tailwind()],
    build: { write: false, rollupOptions: { input: resolve(app, "app/tailwind.css") } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const css = outputs
    .flatMap((o) => o.output)
    .filter((o) => o.type === "asset" && o.fileName.endsWith(".css"))
    .map((o) => (o.type === "asset" ? String(o.source) : ""))
    .join("\n");
  const bundled = await build({
    stdin: {
      contents: readFileSync(
        resolve(root, "tests/browser/harness/entry-mobile-editor.tsx"),
        "utf8",
      ),
      resolveDir: app,
      loader: "tsx",
    },
    alias: {
      "react-router-dom": resolve(
        createRequire(require.resolve("@remix-run/react")).resolve("react-router-dom/package.json"),
        "..",
      ),
    },
    plugins: [
      {
        name: "remix-client-route",
        setup(builder) {
          builder.onLoad({ filter: /\$slug_\.edit\.tsx$/ }, ({ path }) => {
            const source = readFileSync(path, "utf8");
            const start = source.indexOf("export async function loader(");
            const end = source.indexOf("type SaveStatus =");
            if (start < 0 || end < start) {
              throw new Error("Edit route loader boundary changed");
            }
            let client = (source.slice(0, start) + source.slice(end)).replace(
              /^import(?:(?!\nimport)[\s\S])*?from "[^"\n]*server[^"\n]*";\n/gm,
              "",
            );
            client = client.replace(
              /^import(?:(?!\nimport)[\s\S])*?from "(?:@remix-run\/node|arp-domain|arp-headers\/view|\.\.\/edit\/(?:load-document|loader-data|unopenable))";\n/gm,
              "",
            );
            return { contents: client, loader: "tsx" };
          });
        },
      },
    ],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const page = resolve(
    root,
    `tests/browser/harness/index.mobile-editor.${fixture.includes("ai-readiness") ? "real" : "plain"}.generated.html`,
  );
  const report = readFileSync(resolve(root, fixture), "utf8");
  const safe = (s: string) => s.replace(/<\/script>/g, "<\\/script>");
  writeFileSync(
    page,
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="text/plain" id="report-src">${safe(report)}</script><script>${safe(bundled.outputFiles[0].text)}</script></body></html>`,
  );
  return page;
}
