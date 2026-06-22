// Vercel serverless function entry (committed, so Vercel reliably detects it).
// It re-exports the esbuild-bundled app from `dist/server.mjs` — a real built
// artifact produced by `pnpm build` before Vercel processes this function. The
// bundle has no unresolved relative imports, so it loads cleanly as native ESM
// (the fix for the earlier ERR_MODULE_NOT_FOUND, ADR-0051). The default export
// is the Express app, which Vercel runs as the function handler.
export { default } from "../dist/server.mjs";
