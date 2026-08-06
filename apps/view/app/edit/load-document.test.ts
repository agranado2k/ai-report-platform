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

const SLUG = "abcde12345";

const load = async (blobs: InMemoryBlobStore, warn?: (line: string) => void) =>
  loadEditableDocument({
    blobs,
    reportId: RID,
    versionId: VID,
    entryDocument: ENTRY,
    slug: SLUG,
    warn,
  });

/** A document whose BODY splits fine but blows ProseMirror's recursive HTML
 *  parse (stack overflow). This is the third failure mode — the one that stayed
 *  a silent 500 — and it is reachable from a plain upload: bundles are stored
 *  VERBATIM, so nothing normalises nesting depth on the way in. */
const deeplyNested = `<!doctype html><html><body>${"<div>".repeat(50_000)}x${"</div>".repeat(50_000)}</body></html>`;

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

  // THE LAST UNGUARDED CALL. `parseBody` was the only line in a function whose
  // whole contract is "never crash" that could still throw — and it is the line
  // every report with NO `_source.json` sidecar goes through, i.e. every
  // uploaded-never-edited report, which is exactly the incident report's shape.
  //
  // The explicit timeout is load-bearing, not padding: 50k nested elements is
  // what it takes to overflow the recursive DOM walk RELIABLY across engines,
  // and building + parsing that costs ~6s — over vitest's 5s default, so this
  // test failed on timing alone under any parallel load. Shrinking the fixture
  // would make it fast and make it stop proving anything (a shallower document
  // parses fine), so the budget moves instead.
  it(
    "a body ProseMirror cannot parse degrades with `document-unparsable`, never a 500",
    async () => {
      expect(await load(await storeWith(file(ENTRY, deeplyNested)))).toEqual({
        kind: "degraded",
        reason: "document-unparsable",
      });
    },
    30_000,
  );

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

  // WRONG SHAPE, not just malformed bytes. `JSON.parse` happily returns these,
  // so they sailed past the try/catch and were handed to the client as a
  // `PMDocJson` — where `PMNode.fromJSON` throws at MOUNT, client-side, long
  // past every degrade this module can offer.
  it.each<[string, string]>([
    ["null", "null"],
    ["an array", "[]"],
    ["a number", "42"],
    ["a string", '"doc"'],
    ["an object with no type", "{}"],
    ["an object of the wrong type", '{"type":"paragraph"}'],
  ])("a `_source.json` containing %s falls back to the body too", async (_n, json) => {
    const warn = vi.fn();
    const loaded = await load(await storeWith(file(ENTRY, DOC), file("_source.json", json)), warn);
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") expect(loaded.doc.type).toBe("doc");
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "edit-source-sidecar-unparsable",
    });
  });

  // Every OTHER view-origin event keys on `slug`; this one carried only
  // `versionId`, so it could not be correlated with the degrade line emitted
  // for the same request.
  it("the sidecar warning carries the slug, so it correlates with the degrade line", async () => {
    const warn = vi.fn();
    await load(await storeWith(file(ENTRY, DOC), file("_source.json", "{oops")), warn);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({ slug: SLUG });
  });
});
