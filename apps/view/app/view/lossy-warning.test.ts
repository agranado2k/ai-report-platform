import type { BlobStore } from "arp-application";
import { reportId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { loadLossyWarning } from "./lossy-warning";

const REPORT = reportId("report_abc");
const VERSION = versionId("version_abc");

/** A deck: inline <script> and inline <svg> are exactly what the Report HTML
 *  schema drops, so this is the document ADR-0090 was written for. */
const LOSSY_DECK =
  "<html><body><section class='slide'><h1>Q3</h1>" +
  "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'></circle></svg>" +
  "<script>console.log('deck')</script></section></body></html>";

const PLAIN = "<html><body><h1>Q3</h1><p>A plain paragraph.</p></body></html>";

function blobsReturning(html: string | null): BlobStore {
  return {
    readObject: async () =>
      html === null
        ? { ok: true as const, value: null }
        : {
            ok: true as const,
            value: { path: "index.html", bytes: new TextEncoder().encode(html) },
          },
    putVersionBundle: async () => ({ ok: true as const, value: undefined }),
    deleteVersionPrefix: async () => ({ ok: true as const, value: undefined }),
  } as unknown as BlobStore;
}

const failingBlobs = {
  readObject: async () => ({ ok: false as const, error: { kind: "storage" } }),
} as unknown as BlobStore;

/** Collect the structured log lines instead of letting them reach stderr. The
 *  `warn` seam exists so the two failure branches are observable; injecting it
 *  is what makes that observability a tested claim rather than a hope — an
 *  operator greps these event names, so a silent rename should fail here. */
function captureWarnings() {
  const lines: string[] = [];
  return {
    lines,
    warn: (line: string) => lines.push(line),
    /** The single line this branch is expected to have logged, parsed. Throws
     *  rather than returning undefined, so a branch that logged NOTHING fails
     *  here instead of silently passing a `toMatchObject` against undefined. */
    only(): unknown {
      if (lines.length !== 1) throw new Error(`expected exactly 1 log line, got ${lines.length}`);
      return JSON.parse(lines[0] as string);
    },
  };
}

const args = (over: Partial<Parameters<typeof loadLossyWarning>[0]> = {}) => ({
  blobs: blobsReturning(LOSSY_DECK),
  reportId: REPORT,
  versionId: VERSION,
  entryDocument: "index.html",
  fidelity: "lossy" as const,
  slug: "abcde12345",
  ...over,
});

describe("loadLossyWarning (ADR-0090 §1 amendment, #364)", () => {
  it("names the elements a save would drop", async () => {
    const warning = await loadLossyWarning(args());
    expect(warning).not.toBeNull();
    expect(warning?.lostElements).toContain("script");
    expect(warning?.lostElements).toContain("svg");
  });

  it("reads nothing at all for a lossless version — the common path pays nothing", async () => {
    // The RECORDED verdict is the gate. This is what keeps a parse + serialise
    // off every owner-view render: only a version already known to be lossy is
    // ever re-probed.
    let read = false;
    const blobs = {
      readObject: async () => {
        read = true;
        return { ok: true as const, value: null };
      },
    } as unknown as BlobStore;

    expect(await loadLossyWarning(args({ blobs, fidelity: "lossless" }))).toBeNull();
    expect(read).toBe(false);
  });

  it("reads nothing for the UNKNOWN verdict — null is never read as lossy", async () => {
    let read = false;
    const blobs = {
      readObject: async () => {
        read = true;
        return { ok: true as const, value: null };
      },
    } as unknown as BlobStore;

    expect(await loadLossyWarning(args({ blobs, fidelity: null }))).toBeNull();
    expect(read).toBe(false);
  });

  it("still warns when the bytes cannot be read — it just cannot name the items", async () => {
    // The recorded verdict decides WHETHER to warn; the re-probe only supplies
    // the NAMES. Withholding the dialog because a blob read failed would turn
    // an infrastructure hiccup into a silent lossy save, which is the exact
    // outcome this whole ticket exists to prevent.
    const log = captureWarnings();
    const warning = await loadLossyWarning(args({ blobs: failingBlobs, warn: log.warn }));
    expect(warning).not.toBeNull();
    expect(warning?.lostElements).toEqual([]);
    expect(warning?.lostAttributes).toEqual([]);
    // The failure is silent to the user by design, so it must not be silent to
    // the operator: one structured line, keyed on slug like every other
    // view-origin event.
    expect(log.only()).toMatchObject({
      event: "owner-view-lossy-items-unreadable",
      slug: "abcde12345",
    });
  });

  it("still warns when the document is absent from the blob store", async () => {
    const log = captureWarnings();
    const warning = await loadLossyWarning(args({ blobs: blobsReturning(null), warn: log.warn }));
    expect(warning).not.toBeNull();
    expect(warning?.lostElements).toEqual([]);
    expect(log.only()).toMatchObject({ event: "owner-view-lossy-items-unreadable" });
  });

  it("still warns when the fresh probe disagrees with the recorded verdict", async () => {
    // ADR-0090's Consequences accept that a recorded answer can go stale
    // relative to the schema of the day. One rule, applied here: the recorded
    // verdict is what decides, so a version recorded `lossy` whose round trip
    // is clean TODAY still asks for confirmation — with nothing to name.
    const warning = await loadLossyWarning(args({ blobs: blobsReturning(PLAIN) }));
    expect(warning).not.toBeNull();
    expect(warning?.lostElements).toEqual([]);
    expect(warning?.lostAttributes).toEqual([]);
  });

  it("never throws — a probe on a read path must not become a new crash site", async () => {
    const exploding = {
      readObject: async () => {
        throw new Error("R2 exploded");
      },
    } as unknown as BlobStore;

    const log = captureWarnings();
    await expect(
      loadLossyWarning(args({ blobs: exploding, warn: log.warn })),
    ).resolves.not.toBeNull();
    // A thrown read is a DIFFERENT event from a read that merely came back
    // empty — the two failure branches must stay distinguishable in the logs.
    expect(log.only()).toMatchObject({ event: "owner-view-lossy-items-failed" });
  });
});
