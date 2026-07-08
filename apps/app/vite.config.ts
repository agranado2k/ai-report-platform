import { vitePlugin as remix } from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Keep native / awkward-to-bundle deps external so the SSR bundler doesn't inline
  // them (which drops assets or breaks module-format interop); Vercel traces them in.
  // - @node-rs/argon2 (ADR-0056) ships a native `.node` binary.
  // - linkedom (via arp-report-html, server-side DOM) — externalized for the same
  //   safety as argon2; it replaced jsdom, which was un-shippable on the serverless
  //   runtime (css-tree data-file tracing, then html-encoding-sniffer ESM interop).
  ssr: { external: ["@node-rs/argon2", "linkedom"] },
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
