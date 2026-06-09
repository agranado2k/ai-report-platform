// HtmlBundleProcessor — Phase-1 single-document bundle processing: treat the
// uploaded bytes as one HTML document served as index.html, hash it for the
// idempotency key (ADR-0039). The real zip-extraction + MIME-sniff + caps
// processor (ADR-0037 §1/§9, ADR-0015) is a later slice; this unblocks the
// upload→view demo while keeping the use case unchanged.

import { createHash } from "node:crypto";
import type { BundleProcessor, ProcessedBundle } from "arp-application";
import { type AppError, ok, type Result } from "arp-domain";

export class HtmlBundleProcessor implements BundleProcessor {
  async process(_filename: string, bytes: Uint8Array): Promise<Result<ProcessedBundle, AppError>> {
    if (bytes.byteLength === 0) {
      return { ok: false, error: { kind: "ValidationError", message: "empty upload" } };
    }
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    return ok({
      files: [{ path: "index.html", contentType: "text/html; charset=utf-8", bytes }],
      entryDocument: "index.html",
      contentHash,
      sizeBytes: bytes.byteLength,
    });
  }
}
