// Vercel serverless entry — a default-exported Express app is run as the function
// handler (Vercel Node runtime). The vercel.json rewrite routes every path here,
// so Express handles /mcp + /health internally.
import { createApp } from "../src/app";

export default createApp();
