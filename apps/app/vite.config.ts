import { vitePlugin as remix } from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Keep native / data-file-bearing deps external so the SSR bundler doesn't inline
  // them (which drops their non-JS assets); Vercel then traces them into the function.
  // - @node-rs/argon2 (ADR-0056) ships a native `.node` binary.
  // - jsdom (via arp-report-html) pulls css-tree, which `require`s `data/patch.json`
  //   at load — bundling mangles that path and 500s every route at boot (this fix).
  ssr: { external: ["@node-rs/argon2", "jsdom"] },
  plugins: [
    // Tailwind v4 (CSS-first @theme tokens) — must run before Remix's CSS handling.
    tailwindcss(),
    remix({
      presets: [vercelPreset()],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
});
