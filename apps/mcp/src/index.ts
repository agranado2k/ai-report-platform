// Bundle entry for the Vercel function. esbuild bundles this (+ all relative
// imports, resolved at BUILD time) into `dist/server.mjs`; the committed
// `api/index.mjs` shim re-exports that built bundle as the Vercel function.
// This is why source imports stay extensionless — module resolution happens at
// build time, not via Node's runtime ESM resolver (ADR-0051).
import { createApp } from "./app";

export default createApp();
