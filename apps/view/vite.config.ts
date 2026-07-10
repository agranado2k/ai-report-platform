import { vitePlugin as remix } from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // The view pulls @node-rs/argon2 transitively via arp-adapters (it never calls it).
  // Its native `.node` binary can't be bundled — keep it external (ADR-0056).
  ssr: { external: ["@node-rs/argon2"] },
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
