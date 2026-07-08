import { folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { makeAppTestHarness } from "../testing/harness";
import { saveEditedVersion } from "./save-edited-version";
import type { UploadActor } from "./upload-report";
import { uploadReport } from "./upload-report";

const makeDeps = makeAppTestHarness;

const sv = (s: string) => {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
};

const actor = (over: Partial<UploadActor> = {}): UploadActor => ({
  userId: userId("u1"),
  orgId: orgId("o1"),
  folderId: folderId("f1"),
  scopes: ["reports:write"],
  ...over,
});

describe("saveEditedVersion", () => {
  it(
    "saves a new editor-origin ReportVersion at the report's existing slug, " +
      "with the _source.json sidecar written alongside it",
    async () => {
      const { deps, reports, blobs } = makeDeps();
      // The report must already exist — an editor session always opens a live
      // report first (ADR-0062 §5: no create path for edit-save).
      await uploadReport(deps, {
        actor: actor(),
        upload: { filename: "index.html", bytes: new TextEncoder().encode("<h1>hi</h1>") },
      });

      const sourceDoc = { type: "doc", content: [{ type: "paragraph" }] };
      const r = await saveEditedVersion(deps, {
        actor: actor(),
        slug: "slug000001",
        html: new TextEncoder().encode("<html><body><h1>hi edited</h1></body></html>"),
        sourceDoc,
      });

      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.result).toMatchObject({ slug: "slug000001", version: 2 });

      const found = await reports.findBySlug(sv("slug000001"));
      const v2 = found.ok ? found.value?.versions.find((v) => v.versionNo === 2) : undefined;
      expect(v2?.origin).toBe("editor");

      const sidecar = await blobs.readObject(reportId("r1"), versionId("v2"), "_source.json");
      expect(sidecar.ok).toBe(true);
      const decoded =
        sidecar.ok && sidecar.value
          ? JSON.parse(new TextDecoder().decode(sidecar.value.bytes))
          : null;
      expect(decoded).toEqual(sourceDoc);
    },
  );

  it("rejects a save by a non-owner (mirrors re-upload's canWrite authorization exactly)", async () => {
    const { deps } = makeDeps();
    await uploadReport(deps, {
      actor: actor(),
      upload: { filename: "index.html", bytes: new TextEncoder().encode("<h1>hi</h1>") },
    });

    const r = await saveEditedVersion(deps, {
      actor: actor({ userId: userId("u2") }),
      slug: "slug000001",
      html: new TextEncoder().encode("<html><body><h1>hacked</h1></body></html>"),
      sourceDoc: { type: "doc", content: [] },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toEqual({
        kind: "NotAllowed",
        message: "you do not have write access to this report",
      });
    }
  });
});
