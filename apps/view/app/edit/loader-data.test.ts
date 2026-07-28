import { describe, expect, it } from "vitest";
import { buildEditLoaderExtras } from "./loader-data";
import type { CommentWire, VersionWire } from "./wire-types";

const COMMENT: CommentWire = {
  object: "comment",
  id: "comment_1",
  report_id: "report_1",
  author_id: "user_1",
  parent_id: null,
  body: "hi",
  intent: "note",
  anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
  resolved_at: null,
  created_at: "2026-07-08T00:00:00.000Z",
  mode: "prod",
};

const VERSION: VersionWire = {
  object: "version",
  id: "version_1",
  version_no: 1,
  uploaded_by: "user_1",
  uploaded_at: "2026-07-08T00:00:00.000Z",
  scan_status: "clean",
  size_bytes: 10,
  origin: "upload",
  mode: "prod",
};

describe("buildEditLoaderExtras", () => {
  it("passes through both lists when both loads succeed", () => {
    const result = buildEditLoaderExtras(
      { ok: true, comments: [COMMENT], has_more: false },
      { ok: true, versions: [VERSION], has_more: false },
    );
    expect(result).toEqual({
      comments: [COMMENT],
      versions: [VERSION],
      commentsHasMore: false,
      versionsHasMore: false,
    });
  });

  it("degrades comments to an empty list when the comments load fails, without touching versions", () => {
    const result = buildEditLoaderExtras(
      { ok: false, expired: false, message: "boom" },
      { ok: true, versions: [VERSION], has_more: false },
    );
    expect(result).toEqual({
      comments: [],
      versions: [VERSION],
      commentsHasMore: false,
      versionsHasMore: false,
    });
  });

  it("degrades versions to an empty list when the versions load fails, without touching comments", () => {
    const result = buildEditLoaderExtras(
      { ok: true, comments: [COMMENT], has_more: false },
      { ok: false, expired: true, message: "session expired" },
    );
    expect(result).toEqual({
      comments: [COMMENT],
      versions: [],
      commentsHasMore: false,
      versionsHasMore: false,
    });
  });

  it("degrades both to empty lists when both loads fail — never throws", () => {
    const result = buildEditLoaderExtras(
      { ok: false, expired: false, message: "boom" },
      { ok: false, expired: false, message: "boom" },
    );
    expect(result).toEqual({
      comments: [],
      versions: [],
      commentsHasMore: false,
      versionsHasMore: false,
    });
  });
});
