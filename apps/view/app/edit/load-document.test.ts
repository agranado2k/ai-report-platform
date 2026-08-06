// The editor's document load — the step BETWEEN the gate saying "serve" and
// the editor rendering. Extracted from the /edit loader by the 2026-08-06
// owner-lockout fix: these two failure modes (the blob read, the shell split)
// are the ONLY remaining ways a fully-authorized owner can be bounced off
// their own /edit route, and until now they were untested, unlogged, and
// hard-coded to degrade to the BARE public viewer — which unlock-walls a
// private report's owner. They are the leading candidates for the production
// incident itself (a 47 KB uploaded document that the read-only viewer streams
// happily but the editor cannot open).
import type { BlobFile } from "arp-application";
import { InMemoryBlobStore } from "arp-application/testing";
import { reportId, versionId } from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import { loadEditableDocument } from "./load-document";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");
const ENTRY = "index.html";

const DOC = `<!doctype html><html><head><title>R</title></head><body><p>hi</p></body></html>`;

const file = (path: string, body: string): BlobFile => ({
  path,
  contentType: path.endsWith(".json") ? "application/json" : "text/html; charset=utf-8",
  bytes: new TextEncoder().encode(body),
});

async function storeWith(...files: readonly BlobFile[]): Promise<InMemoryBlobStore> {
  const blobs = new InMemoryBlobStore();
  if (files.length > 0) await blobs.putVersionBundle(RID, VID, files);
  return blobs;
}

const load = async (blobs: InMemoryBlobStore, warn?: (line: string) => void) =>
  loadEditableDocument({ blobs, reportId: RID, versionId: VID, entryDocument: ENTRY, warn });

describe("loadEditableDocument", () => {
  it("loads the entry document and splits it into shell + ProseMirror doc", async () => {
    const loaded = await load(await storeWith(file(ENTRY, DOC)));
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") {
      expect(loaded.shell.pre).toContain("<title>R</title>");
      expect(loaded.doc.type).toBe("doc");
    }
  });

  it("prefers the lossless `_source.json` sidecar over re-parsing the body HTML", async () => {
    const sidecar = { type: "doc", content: [{ type: "paragraph" }] };
    const loaded = await load(
      await storeWith(file(ENTRY, DOC), file("_source.json", JSON.stringify(sidecar))),
    );
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") expect(loaded.doc).toEqual(sidecar);
  });

  // THE INCIDENT CANDIDATES ------------------------------------------------
  it("a missing entry document degrades with `document-unreadable` (never a bare 302)", async () => {
    expect(await load(await storeWith())).toEqual({
      kind: "degraded",
      reason: "document-unreadable",
    });
  });

  it("a blob-store failure degrades with `document-unreadable` too (never throws)", async () => {
    const failing = {
      readObject: async () => ({
        ok: false as const,
        error: { kind: "Unexpected", message: "r2" },
      }),
    } as unknown as InMemoryBlobStore;
    expect(await load(failing)).toEqual({ kind: "degraded", reason: "document-unreadable" });
  });

  it.each<[string, string]>([
    ["no <body> at all", "<!doctype html><html><head></head></html>"],
    ["an unclosed body", "<!doctype html><html><body><p>hi</p></html>"],
    ["a bare fragment", "<h1>Just a fragment</h1><p>uploaded verbatim</p>"],
  ])("%s degrades with `document-unsplittable` rather than throwing", async (_n, html) => {
    expect(await load(await storeWith(file(ENTRY, html)))).toEqual({
      kind: "degraded",
      reason: "document-unsplittable",
    });
  });

  // A corrupt sidecar used to be an UNCAUGHT JSON.parse in the loader — a 500
  // on a report the editor could otherwise have opened by re-parsing the body.
  it("a corrupt `_source.json` falls back to parsing the body, and says so", async () => {
    const warn = vi.fn();
    const loaded = await load(
      await storeWith(file(ENTRY, DOC), file("_source.json", "{oops")),
      warn,
    );
    expect(loaded.kind).toBe("loaded");
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "edit-source-sidecar-unparsable",
    });
  });
});
