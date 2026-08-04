import { folderId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  ACTORS,
  folder,
  makeFolderAccessDeps,
  makeGrantCheckDeps,
  makeOwnerMutationDeps,
  report,
  slug,
} from "../testing/fixtures";
import { InMemoryFolderRepository, InMemoryGrantStore } from "../testing/in-memory";
import {
  applyFolderSharingToReports,
  MAX_SHARING_BULK_APPLY,
  sharingApplyIsPartial,
} from "./apply-folder-sharing-to-reports";
import { setAcl } from "./set-acl";
import { setReportSharing } from "./set-report-sharing";

const { orgA, owner, otherUser } = ACTORS;
const FOLDER_ID = folderId("00000000-0000-7000-8000-0000000000f7");
const ACTOR = { orgId: orgA, userId: owner, scopes: ["acl:write"] };

const FAKE_HASHER = {
  async hash() {
    return { ok: true as const, value: "x" };
  },
  async verify() {
    return { ok: true as const, value: true };
  },
};

async function seed() {
  const base = makeOwnerMutationDeps();
  const folders = new InMemoryFolderRepository();
  // An org-visible, owned folder — the shape the panel offers this action on.
  await folders.save(
    folder(FOLDER_ID, orgA, "House Numbers", {
      parentId: folderId("00000000-0000-7000-8000-0000000000a0"),
      ownerId: owner,
      visibility: "org",
    }),
  );
  const grantDeps = makeGrantCheckDeps();
  const deps = {
    ...base,
    ...makeFolderAccessDeps(),
    folders,
    grants: new InMemoryGrantStore({ now: () => Date.now() }),
    orgWriteGrants: grantDeps.orgWriteGrants,
  };
  return deps;
}

type Deps = Awaited<ReturnType<typeof seed>>;

async function place(
  deps: Deps,
  slugStr: string,
  overrides: { readonly ownerId?: typeof owner; readonly title?: string } = {},
) {
  const rpt = report(orgA, slugStr, { ...overrides, folderId: FOLDER_ID });
  await deps.reports.save(rpt);
  return rpt;
}

describe("applyFolderSharingToReports (ADR-0078 §5)", () => {
  it("requires the acl:write scope", async () => {
    const deps = await seed();
    const r = await applyFolderSharingToReports(
      deps,
      { orgId: orgA, userId: owner, scopes: [] },
      { folderId: FOLDER_ID, sharing: "org_view" },
    );
    expect(!r.ok && r.error.kind).toBe("InsufficientScope");
  });

  it("refuses a folder the actor cannot SEE as NotFound — existence is private", async () => {
    const deps = await seed();
    const r = await applyFolderSharingToReports(deps, ACTOR, {
      folderId: folderId("00000000-0000-7000-8000-0000000000ff"),
      sharing: "org_view",
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("shares the actor's own private reports inside the folder", async () => {
    const deps = await seed();
    const a = await place(deps, "aaaaaaaaaa");
    const b = await place(deps, "bbbbbbbbbb");
    const r = await applyFolderSharingToReports(deps, ACTOR, {
      folderId: FOLDER_ID,
      sharing: "org_view",
    });
    expect(r.ok && r.value.changed.map((c) => c.slug).sort()).toEqual([a.slug, b.slug].sort());
    expect(r.ok && r.value.total).toBe(2);
    const after = await deps.reports.findById(a.id);
    expect(after.ok && after.value?.acl.mode).toBe("org");
  });

  it("org_edit grants the org-write row on each report it changes", async () => {
    const deps = await seed();
    const a = await place(deps, "aaaaaaaaaa");
    await applyFolderSharingToReports(deps, ACTOR, {
      folderId: FOLDER_ID,
      sharing: "org_edit",
    });
    const grant = await deps.orgWriteGrants.find(a.id);
    expect(grant.ok && grant.value).not.toBeNull();
  });

  describe("the candidate rule, and its honest skips", () => {
    it("SKIPS a colleague's report and names the reason — never claims it changed", async () => {
      const deps = await seed();
      const mine = await place(deps, "aaaaaaaaaa");
      const theirs = await place(deps, "bbbbbbbbbb", { ownerId: otherUser });
      // The colleague's report is only in the actor's listing because it is
      // org-shared; a private one of theirs would never even be enumerated.
      await setAcl(
        { ...deps, hasher: FAKE_HASHER },
        { ...ACTOR, userId: otherUser },
        {
          slug: slug(theirs.slug),
          mode: "org",
        },
      );
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      expect(r.ok && r.value.changed.map((c) => c.slug)).toEqual([mine.slug]);
      expect(r.ok && r.value.skipped).toEqual([
        { slug: theirs.slug, title: "A Title", reason: "not owned by you" },
      ]);
    });

    it("SKIPS a password-protected report rather than publishing it", async () => {
      const deps = await seed();
      const locked = await place(deps, "cccccccccc");
      await setAcl({ ...deps, hasher: FAKE_HASHER }, ACTOR, {
        slug: slug(locked.slug),
        mode: "password",
        password: "hunter2",
      });
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      expect(r.ok && r.value.skipped.map((s) => s.reason)).toEqual(["password-protected"]);
      const after = await deps.reports.findById(locked.id);
      expect(after.ok && after.value?.acl.mode).toBe("password");
    });

    it("SKIPS one already at the destination rather than counting it as changed", async () => {
      const deps = await seed();
      const already = await place(deps, "dddddddddd");
      await setReportSharing(deps, ACTOR, { slug: slug(already.slug), sharing: "org_view" });
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      expect(r.ok && r.value.changed).toEqual([]);
      expect(r.ok && r.value.skipped.map((s) => s.reason)).toEqual([
        "already shared with your org",
      ]);
    });
  });

  describe("the private direction", () => {
    it("takes the actor's org-shared reports back, revoking org write", async () => {
      const deps = await seed();
      const a = await place(deps, "aaaaaaaaaa");
      await setReportSharing(deps, ACTOR, { slug: slug(a.slug), sharing: "org_edit" });
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "private",
      });
      expect(r.ok && r.value.changed.map((c) => c.slug)).toEqual([a.slug]);
      const after = await deps.reports.findById(a.id);
      expect(after.ok && after.value?.acl.mode).toBe("private");
      const grant = await deps.orgWriteGrants.find(a.id);
      expect(grant.ok && grant.value).toBeNull();
    });

    it("still refuses to discard an advanced mode", async () => {
      const deps = await seed();
      const locked = await place(deps, "cccccccccc");
      await setAcl({ ...deps, hasher: FAKE_HASHER }, ACTOR, {
        slug: slug(locked.slug),
        mode: "public",
      });
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "private",
      });
      expect(r.ok && r.value.skipped.map((s) => s.reason)).toEqual(["already public"]);
    });
  });

  describe("the cap refuses PRE-FLIGHT (ADR-0078 §5)", () => {
    it("changes nothing at all when the folder is over the cap", async () => {
      const deps = await seed();
      // Distinct HEX two-char prefixes: the `report()` fixture derives the
      // report id from the slug's first two characters, so a shared prefix
      // would collapse 51 reports into one row.
      const hex = "0123456789abcdef";
      for (let i = 0; i <= MAX_SHARING_BULK_APPLY; i += 1) {
        const prefix = `${hex[Math.floor(i / 16)]}${hex[i % 16]}`;
        await place(deps, `${prefix}zzzzzzzz`);
      }
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      expect(!r.ok && r.error.kind).toBe("ValidationError");
      if (!r.ok) expect(r.error.message).toContain("Nothing was changed");
      // A refusal must change NOTHING — the point of enumerating first.
      const page = await deps.reports.searchByOrg(
        orgA,
        { userId: owner },
        { folderId: FOLDER_ID, limit: 100 },
      );
      expect(page.ok).toBe(true);
      for (const item of page.ok ? page.value.items : []) {
        const full = await deps.reports.findById(item.id);
        expect(full.ok && full.value?.acl.mode).toBe("private");
      }
    });
  });

  describe("partial results are reported, never rounded up", () => {
    it("sharingApplyIsPartial is false for a clean run and true when something failed", async () => {
      const deps = await seed();
      await place(deps, "aaaaaaaaaa");
      const clean = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      expect(clean.ok && sharingApplyIsPartial(clean.value)).toBe(false);

      expect(
        sharingApplyIsPartial({
          sharing: "org_view",
          changed: [],
          skipped: [],
          failed: [{ slug: "x", title: "t", reason: "db down" }],
          total: 1,
        }),
      ).toBe(true);
    });

    it("a SKIP is not a failure — the two are reported separately", async () => {
      const deps = await seed();
      const locked = await place(deps, "cccccccccc");
      await setAcl({ ...deps, hasher: FAKE_HASHER }, ACTOR, {
        slug: slug(locked.slug),
        mode: "public",
      });
      const r = await applyFolderSharingToReports(deps, ACTOR, {
        folderId: FOLDER_ID,
        sharing: "org_view",
      });
      // The rule working as designed must not read as a server failure.
      expect(r.ok && r.value.failed).toEqual([]);
      expect(r.ok && sharingApplyIsPartial(r.value)).toBe(false);
    });
  });

  it("never touches a report outside the folder", async () => {
    const deps = await seed();
    const inside = await place(deps, "aaaaaaaaaa");
    const outside = report(orgA, "bbbbbbbbbb");
    await deps.reports.save(outside);
    await applyFolderSharingToReports(deps, ACTOR, {
      folderId: FOLDER_ID,
      sharing: "org_view",
    });
    const untouched = await deps.reports.findById(outside.id);
    expect(untouched.ok && untouched.value?.acl.mode).toBe("private");
    const touched = await deps.reports.findById(inside.id);
    expect(touched.ok && touched.value?.acl.mode).toBe("org");
  });
});
