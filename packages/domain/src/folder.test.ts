import { describe, expect, it } from "vitest";
import { folderId, orgId } from "./brand";
import { createFolder, folderSlug, renameFolder } from "./folder";

const org = orgId("00000000-0000-7000-8000-0000000000a1");
const parent = folderId("00000000-0000-7000-8000-0000000000f0");
const id = folderId("00000000-0000-7000-8000-0000000000f1");

describe("createFolder", () => {
  it("creates a folder with a slug derived from the name", () => {
    const r = createFolder({ id, orgId: org, parentId: parent, name: "Q1 Reports" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      id,
      orgId: org,
      parentId: parent,
      name: "Q1 Reports",
      slug: "q1-reports",
      deletedAt: null,
    });
  });

  it("supports a top-level folder (parentId null)", () => {
    const r = createFolder({ id, orgId: org, parentId: null, name: "Archive" });
    expect(r.ok && r.value.parentId).toBeNull();
    expect(r.ok && r.value.slug).toBe("archive");
  });

  it("trims the name and rejects an empty one", () => {
    expect(createFolder({ id, orgId: org, parentId: null, name: "   " }).ok).toBe(false);
    const r = createFolder({ id, orgId: org, parentId: null, name: "  Docs  " });
    expect(r.ok && r.value.name).toBe("Docs");
  });

  it("rejects a name with no alphanumeric characters", () => {
    const r = createFolder({ id, orgId: org, parentId: null, name: "///" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("ValidationError");
  });
});

describe("folderSlug", () => {
  it("lowercases, hyphenates runs of non-alphanumerics, and trims hyphens", () => {
    expect(folderSlug("2024 — Q1 / Final!!")).toBe("2024-q1-final");
  });
});

describe("renameFolder", () => {
  const folder = { id, orgId: org, parentId: parent, name: "Old", slug: "old", deletedAt: null };

  it("updates the display name and trims it, keeping the slug stable", () => {
    const r = renameFolder(folder, "  New Name  ");
    expect(r.ok && r.value.name).toBe("New Name");
    expect(r.ok && r.value.slug).toBe("old"); // slug unchanged
  });

  it("rejects an empty name", () => {
    const r = renameFolder(folder, "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });
});
