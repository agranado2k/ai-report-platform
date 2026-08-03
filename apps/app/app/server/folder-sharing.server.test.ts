import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  type Folder,
  type FolderId,
  type FolderVisibility,
  folderId,
  folderIdToWire,
  notAllowed,
  ok,
  orgId,
  type Result,
  userId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  ADOPTION_NOTICE,
  applyFolderVisibility,
  cascadeIsPartial,
  cascadeLabel,
  cascadeScope,
  cascadeSummary,
  folderFormKey,
  folderManagement,
  folderShareWarning,
  folderVisibilityBadge,
  MAX_CASCADE,
  NO_SCOPE_REASON,
  NON_OWNER_REASON,
  ROOT_REASON,
  visibleFolderTree,
} from "./folder-sharing.server";

const org = orgId("00000000-0000-7000-8000-0000000000a1");
const me = userId("00000000-0000-7000-8000-0000000000d1");
const other = userId("00000000-0000-7000-8000-0000000000d2");
const SCOPED = [ACL_WRITE_SCOPE];
const actorMe = { userId: me, scopes: SCOPED };

/** A folder id from a short label, so the tests read as a tree, not as UUIDs. */
function fid(label: string): FolderId {
  return folderId(`00000000-0000-7000-8000-${label.padStart(12, "0")}`);
}

function build(over: {
  readonly id: string;
  readonly parentId?: string | null;
  readonly ownerId?: ReturnType<typeof userId> | null;
  readonly visibility?: FolderVisibility;
  readonly name?: string;
}): Folder {
  return {
    id: fid(over.id),
    orgId: org,
    parentId: over.parentId === undefined || over.parentId === null ? null : fid(over.parentId),
    ownerId: over.ownerId === undefined ? me : over.ownerId,
    visibility: over.visibility ?? "private",
    name: over.name ?? over.id,
    slug: over.id,
    deletedAt: null,
  };
}

/** Root + a parent with two children, one of them legacy and org-visible. */
function sampleFolders(): readonly Folder[] {
  return [
    build({ id: "1", parentId: null, ownerId: null, visibility: "org", name: "Root" }),
    build({ id: "2", parentId: "1", name: "Parent" }),
    build({ id: "3", parentId: "2", name: "Kept" }),
    build({ id: "4", parentId: "2", ownerId: null, visibility: "org", name: "Engeneering" }),
  ];
}

const wire = (label: string) => folderIdToWire(fid(label));

describe("visibleFolderTree (ADR-0076 — ONE tree construction)", () => {
  it("wires every folder with the fields the sidebar and the cascade both need", () => {
    const tree = visibleFolderTree(sampleFolders());
    expect(tree).toHaveLength(4);
    const parent = tree.find((n) => n.name === "Parent");
    expect(parent?.parentId).toBe(tree.find((n) => n.name === "Root")?.id);
    expect(tree.find((n) => n.name === "Engeneering")).toMatchObject({
      ownerId: null,
      visibility: "org",
    });
  });

  it("grafts a visibility ORPHAN under Root — the cascade's scope depends on it", () => {
    // "Kept" is visible but its parent is NOT in this viewer's set, so it is
    // re-parented to Root. If the cascade walked the ungrafted list, "Kept"
    // would count as a descendant of a folder this viewer cannot even see.
    const tree = visibleFolderTree([
      build({ id: "1", parentId: null, ownerId: null, visibility: "org", name: "Root" }),
      build({ id: "3", parentId: "9", name: "Kept" }),
    ]);
    const root = tree.find((n) => n.name === "Root");
    expect(tree.find((n) => n.name === "Kept")?.parentId).toBe(root?.id);
  });

  it("survives a folder set with no Root at all (a degraded listing)", () => {
    const tree = visibleFolderTree([build({ id: "3", parentId: "9", name: "Kept" })]);
    expect(tree).toHaveLength(1);
  });
});

describe("cascadeScope (ADR-0076 §cascade — what a cascade would actually touch)", () => {
  const tree = visibleFolderTree(sampleFolders());
  const parentId = tree.find((n) => n.name === "Parent")?.id ?? "";

  it("counts every descendant, and the LEGACY ones a cascade would adopt", () => {
    const scope = cascadeScope(tree, parentId);
    expect(scope.total).toBe(2);
    expect(scope.legacy).toBe(1);
    expect(scope.ids).toHaveLength(2);
  });

  it("counts the currently-PRIVATE descendants an org cascade would expose", () => {
    expect(cascadeScope(tree, parentId).currentlyPrivate).toBe(1);
  });

  it("is empty for a leaf", () => {
    const leaf = tree.find((n) => n.name === "Kept")?.id ?? "";
    expect(cascadeScope(tree, leaf)).toMatchObject({ total: 0, legacy: 0, currentlyPrivate: 0 });
  });
});

describe("folderVisibilityBadge (ADR-0076 sidebar badge)", () => {
  it("labels an org-visible folder 'Org'", () => {
    expect(folderVisibilityBadge({ visibility: "org", shareCount: 0 })).toMatchObject({
      label: "Org",
      tone: "warning",
    });
  });

  it("labels a private folder with a KNOWN empty roster 'Private'", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 0 })).toMatchObject({
      label: "Private",
      tone: "neutral",
    });
  });

  it("labels a private folder with shares 'Shared with N'", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 3 })).toMatchObject({
      label: "Shared with 3",
      tone: "brand",
    });
  });

  it("gives EVERY badge a title that spells the state out in full", () => {
    // The label is squeezed into a 14rem sidebar next to a truncating folder
    // name, so the sentence version lives in the tooltip rather than being cut
    // from the label (2026-08-03 dogfood, I-1).
    for (const input of [
      { visibility: "org" as const, shareCount: 0 },
      { visibility: "private" as const, shareCount: 0 },
      { visibility: "private" as const, shareCount: 2 },
      { visibility: "private" as const, shareCount: null },
    ]) {
      const badge = folderVisibilityBadge(input);
      expect(badge.title.length, `no title for ${JSON.stringify(input)}`).toBeGreaterThan(20);
    }
  });

  it("singularises the share count", () => {
    expect(folderVisibilityBadge({ visibility: "private", shareCount: 1 }).label).toBe(
      "Shared with 1",
    );
  });

  it("never claims 'Private' when the roster was NOT loaded (null)", () => {
    // The loader pays for one roster (the folder in `?manage=`), so every other
    // private row has an UNKNOWN roster. "Private" there is a positive claim —
    // a folder shared with six people would read "Private" one row below a
    // folder reading "Shared with 2". Say only what is actually known.
    const badge = folderVisibilityBadge({ visibility: "private", shareCount: null });
    expect(badge.label).toBe("Limited");
    expect(badge.label).not.toBe("Private");
    // …and the unknown part is stated in the tooltip, where there is room.
    expect(badge.title).toContain("shared with");
  });

  it("keeps the unknown-roster label as short as the ones it sits beside", () => {
    // "Not org-visible" was honest and unreadable: three times the width of
    // "Org", it truncated a 16-character folder name down to "dog…" in the
    // 14rem sidebar (2026-08-03 dogfood, I-1). Whatever this label becomes, it
    // may not be wider than the widest label it shares a column with.
    const unknown = folderVisibilityBadge({ visibility: "private", shareCount: null }).label;
    const known = folderVisibilityBadge({ visibility: "private", shareCount: 0 }).label;
    expect(unknown.length).toBeLessThanOrEqual(known.length);
    // A double negative reads worse than the claim it replaced.
    expect(unknown.toLowerCase()).not.toContain("not ");
  });

  it("keeps 'Org' even when a share roster exists — org visibility dominates", () => {
    expect(folderVisibilityBadge({ visibility: "org", shareCount: 4 }).label).toBe("Org");
  });
});

describe("folderFormKey (2026-08-03 dogfood I-2/I-4 — the sharing forms must not survive an action)", () => {
  it("CHANGES when the folder's visibility flips — the cascade tick must not survive", () => {
    // The hazard, observed in production: tick "Also make the 1 folder inside
    // this one private", submit, and the reloaded panel came back reading
    // "Share with the whole org" with the checkbox STILL TICKED and the amber
    // mass-exposure warning already on screen. A second click — by someone who
    // didn't re-read — bulk-EXPOSES the subtree. A changed key remounts the
    // form, so the tick cannot outlive the direction it was ticked for.
    const before = folderFormKey({ visibility: "private", shareCount: null });
    const after = folderFormKey({ visibility: "org", shareCount: null });
    expect(after).not.toBe(before);
  });

  it("CHANGES when the roster grows — the submitted address must not stay in the field", () => {
    expect(folderFormKey({ visibility: "private", shareCount: 1 })).not.toBe(
      folderFormKey({ visibility: "private", shareCount: 0 }),
    );
  });

  it("CHANGES when a share is revoked", () => {
    expect(folderFormKey({ visibility: "private", shareCount: 0 })).not.toBe(
      folderFormKey({ visibility: "private", shareCount: 1 }),
    );
  });

  it("distinguishes an UNKNOWN roster from a known-empty one", () => {
    // Otherwise opening `?manage=<id>` on a folder with no shares would look
    // like "nothing changed" and leave a half-typed address in place.
    expect(folderFormKey({ visibility: "private", shareCount: null })).not.toBe(
      folderFormKey({ visibility: "private", shareCount: 0 }),
    );
  });

  it("is STABLE while nothing about the folder's sharing changed", () => {
    // A key that churned on every render would throw away whatever the
    // operator was mid-way through typing.
    expect(folderFormKey({ visibility: "org", shareCount: 2 })).toBe(
      folderFormKey({ visibility: "org", shareCount: 2 }),
    );
  });
});

describe("folderManagement (consumes the DOMAIN rule, ADR-0076 §6)", () => {
  it("the Root is never manageable — the domain rejects any visibility call on it", () => {
    const m = folderManagement(build({ id: "1", parentId: null, ownerId: null }), actorMe);
    expect(m.isRoot).toBe(true);
    expect(m.manageable).toBe(false);
    expect(m.blockedReason).toBe(ROOT_REASON);
  });

  it("a Root that somehow carries an owner is STILL not manageable", () => {
    expect(folderManagement(build({ id: "1", parentId: null }), actorMe).manageable).toBe(false);
  });

  it("the owner may manage their own folder, and is not a legacy adopter", () => {
    const m = folderManagement(build({ id: "2", parentId: "1" }), actorMe);
    expect(m).toMatchObject({
      isRoot: false,
      manageable: true,
      legacy: false,
      blockedReason: null,
    });
  });

  it("a LEGACY folder (ownerId null) is manageable by anyone", () => {
    const m = folderManagement(build({ id: "2", parentId: "1", ownerId: null }), actorMe);
    expect(m.manageable).toBe(true);
    expect(m.legacy).toBe(true);
  });

  it("a visible folder owned by SOMEONE ELSE is blocked, with the server's own reason", () => {
    const m = folderManagement(build({ id: "2", parentId: "1", ownerId: other }), actorMe);
    expect(m.manageable).toBe(false);
    expect(m.blockedReason).toBe(NON_OWNER_REASON);
  });

  it("an actor WITHOUT acl:write manages nothing — even their own folder", () => {
    // The gate every management use case applies first. An edit-token actor
    // carries `reports:write` only (ADR-0063), so without this leg the sidebar
    // would render the toggle ENABLED and its POST would 403.
    const m = folderManagement(build({ id: "2", parentId: "1" }), {
      userId: me,
      scopes: ["reports:write"],
    });
    expect(m.manageable).toBe(false);
    expect(m.blockedReason).toBe(NO_SCOPE_REASON);
  });

  it("an unresolved actor manages nothing (a signed-out/degraded dashboard render)", () => {
    expect(
      folderManagement(build({ id: "2", parentId: "1", ownerId: null }), null).manageable,
    ).toBe(false);
  });
});

describe("folderShareWarning (ADR-0076 — the adoption warning arrives BEFORE the click)", () => {
  const empty = { total: 0, legacy: 0, currentlyPrivate: 0, ids: [] as readonly string[] };

  it("is silent for an owned folder with nothing legacy inside", () => {
    expect(folderShareWarning({ legacy: false, target: "private", scope: empty })).toBeNull();
  });

  it("warns about adopting the folder itself when it is legacy", () => {
    const w = folderShareWarning({ legacy: true, target: "private", scope: empty });
    expect(w).toContain(ADOPTION_NOTICE);
  });

  it("warns about adopting LEGACY DESCENDANTS of a folder the actor already owns", () => {
    // THE case this UI got wrong: migration 0019 left every pre-ADR-0076 folder
    // with owner_id NULL, so legacy is the COMMON state. Cascading from a
    // folder you own seizes permanent ownership of every legacy folder inside
    // it — with no warning at all, because the folder clicked was not legacy.
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: 3, legacy: 2 },
    });
    expect(w).not.toBeNull();
    expect(w).toContain("2 folders");
    expect(w).toContain("owner");
    expect(w).toContain("inside");
  });

  it("singularises a single legacy descendant", () => {
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: 1, legacy: 1 },
    });
    expect(w).toContain("1 folder ");
    expect(w).not.toContain("1 folders");
  });

  it("agrees with a single legacy descendant all the way to the pronoun", () => {
    // "1 folder … other members will no longer be able to change THEIR sharing"
    // counted correctly and then lost agreement in the tail.
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: 1, legacy: 1 },
    });
    expect(w).toContain("change its sharing");
    expect(w).not.toContain("change their sharing");
  });

  it("keeps the plural pronoun for several legacy descendants", () => {
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: 3, legacy: 2 },
    });
    expect(w).toContain("change their sharing");
  });

  it("warns about mass EXPOSURE in the org direction, and that it cannot be undone", () => {
    // The same checkbox publishes currently-private children when the toggle
    // runs the other way, and destroys the per-descendant record so
    // re-cascading private cannot restore it.
    const w = folderShareWarning({
      legacy: false,
      target: "org",
      scope: { ...empty, total: 4, currentlyPrivate: 3 },
    });
    expect(w).toContain("3 folders");
    expect(w).toContain("private");
    expect(w).toContain("that are currently private");
    expect(w).toContain("won't put them back");
  });

  it("agrees in the SINGULAR when exactly one private folder would be exposed", () => {
    // Observed in the 2026-08-03 dogfood run: "make 1 folder that ARE currently
    // private … won't put THEM back". The count was singularised; the verb and
    // the pronoun were not.
    const w = folderShareWarning({
      legacy: false,
      target: "org",
      scope: { ...empty, total: 1, currentlyPrivate: 1 },
    });
    expect(w).toContain("1 folder that is currently private");
    expect(w).not.toContain("that are currently private");
    expect(w).toContain("won't put it back");
    expect(w).not.toContain("won't put them back");
  });

  it("does NOT warn about exposure when the cascade runs toward private", () => {
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: 4, currentlyPrivate: 3 },
    });
    expect(w).toBeNull();
  });

  it("explains the cap instead, when the subtree is too big to cascade at all", () => {
    const w = folderShareWarning({
      legacy: false,
      target: "private",
      scope: { ...empty, total: MAX_CASCADE + 1, legacy: 5 },
    });
    expect(w).toContain(String(MAX_CASCADE));
    expect(w).toContain("batches");
  });
});

describe("cascadeLabel (ADR-0076 — direction-aware, never a bare 'apply to everything')", () => {
  const scope = { total: 3, legacy: 0, currentlyPrivate: 0, ids: [] as readonly string[] };

  it("names the direction and the count when going private", () => {
    expect(cascadeLabel({ target: "private", scope })).toBe(
      "Also make the 3 folders inside this one private",
    );
  });

  it("names the direction and the count when going org — the exposing direction", () => {
    expect(cascadeLabel({ target: "org", scope })).toBe(
      "Also share the 3 folders inside this one with the whole org",
    );
  });

  it("offers no checkbox when there is nothing inside", () => {
    expect(cascadeLabel({ target: "private", scope: { ...scope, total: 0 } })).toBeNull();
  });

  it("offers no checkbox when the subtree exceeds the cap", () => {
    expect(cascadeLabel({ target: "private", scope: { ...scope, total: MAX_CASCADE + 1 } })).toBe(
      null,
    );
  });
});

describe("cascadeSummary (ADR-0076 §cascade — partial failure told honestly)", () => {
  const changed = (name: string, adopted = false) => ({ name, adopted });
  const base = { visibility: "private" as const, unreachable: null };

  it("reports the folder alone when no cascade was requested", () => {
    expect(cascadeSummary({ ...base, changed: [], failed: [], cascaded: false })).toBe(
      "Set to private.",
    );
  });

  it("counts the descendants that actually changed", () => {
    expect(
      cascadeSummary({
        ...base,
        changed: [changed("Specs"), changed("Drafts")],
        failed: [],
        cascaded: true,
      }),
    ).toBe("Set to private, and applied to 2 folders inside: Specs, Drafts.");
  });

  it("says so when a cascade found nothing inside", () => {
    expect(
      cascadeSummary({ ...base, visibility: "org", changed: [], failed: [], cascaded: true }),
    ).toBe("Set to org. Nothing inside this folder needed changing.");
  });

  it("names the descendants it ADOPTED separately from the ones it merely changed", () => {
    const summary = cascadeSummary({
      ...base,
      changed: [changed("Specs"), changed("Engeneering", true)],
      failed: [],
      cascaded: true,
    });
    expect(summary).toContain("applied to 2 folders inside: Specs, Engeneering");
    expect(summary).toContain("You're now the owner of 1 of them: Engeneering.");
  });

  it("never claims success for a folder that failed — it names each one and why", () => {
    const summary = cascadeSummary({
      ...base,
      changed: [changed("Specs")],
      failed: [{ name: "Ops", reason: "only the folder's owner can manage its sharing" }],
      cascaded: true,
    });
    expect(summary).toContain("applied to 1 folder inside: Specs");
    expect(summary).toContain("1 folder was NOT changed");
    expect(summary).toContain("Ops (only the folder's owner can manage its sharing)");
  });

  it("reports a total failure without any success claim at all", () => {
    const summary = cascadeSummary({
      ...base,
      changed: [],
      failed: [
        { name: "Ops", reason: "denied" },
        { name: "Legal", reason: "denied" },
      ],
      cascaded: true,
    });
    expect(summary).toBe(
      "Set to private. 2 folders were NOT changed: Ops (denied), Legal (denied).",
    );
    expect(summary).not.toContain("applied to");
  });

  it("says the inside could not be READ, without inventing a count for it", () => {
    // The old code pushed a sentinel `{ name: "everything inside" }` through the
    // failure counter, rendering "1 folder was NOT changed: everything inside"
    // for a whole subtree of unknown size.
    const summary = cascadeSummary({
      ...base,
      changed: [],
      failed: [],
      cascaded: true,
      unreachable: "the folder list is unavailable",
    });
    expect(summary).toContain("could not be checked");
    expect(summary).toContain("the folder list is unavailable");
    expect(summary).not.toContain("1 folder");
    expect(summary).not.toContain("everything inside");
  });
});

describe("cascadeIsPartial (the banner's warning/success switch)", () => {
  const base = { visibility: "private" as const, cascaded: true, changed: [], unreachable: null };

  it("is false for a clean cascade", () => {
    expect(cascadeIsPartial({ ...base, failed: [] })).toBe(false);
  });

  it("is TRUE when a descendant was refused", () => {
    expect(cascadeIsPartial({ ...base, failed: [{ name: "Ops", reason: "denied" }] })).toBe(true);
  });

  it("is TRUE when the subtree could not be read at all", () => {
    expect(cascadeIsPartial({ ...base, failed: [], unreachable: "boom" })).toBe(true);
  });
});

// ── The cascade itself ─────────────────────────────────────────────────────

interface FakeOpsOptions {
  readonly listFails?: string;
  readonly refuse?: readonly string[];
}

/** The two `ops()` calls the cascade makes, faked. `refuse` names the folders
 *  whose `setFolderVisibility` is denied — exactly what happens for real when a
 *  descendant is owned by somebody else. */
function fakeOps(folders: readonly Folder[], options: FakeOpsOptions = {}) {
  const calls: { id: string; visibility: FolderVisibility }[] = [];
  const byId = new Map(folders.map((f) => [String(f.id), f]));
  return {
    calls,
    ops: {
      listFolders: async (): Promise<Result<{ readonly items: readonly Folder[] }, AppError>> =>
        options.listFails
          ? err({ kind: "Unexpected", message: options.listFails })
          : ok({ items: folders }),
      setFolderVisibility: async (
        _actor: unknown,
        input: { readonly folderId: FolderId; readonly visibility: FolderVisibility },
      ): Promise<Result<Folder, AppError>> => {
        const found = byId.get(String(input.folderId));
        if (found && (options.refuse ?? []).includes(found.name)) {
          return { ok: false, error: notAllowed("only the folder's owner can manage its sharing") };
        }
        calls.push({ id: String(input.folderId), visibility: input.visibility });
        return ok({ ...(found as Folder), visibility: input.visibility });
      },
    },
  };
}

const cascadeActor = { orgId: org, userId: me, scopes: SCOPED };

function parentInput(cascade: boolean, visibility: FolderVisibility = "private") {
  return { folderWireId: wire("2"), folderId: fid("2"), visibility, cascade };
}

describe("applyFolderVisibility (ADR-0076 §cascade — the loop, under test at last)", () => {
  it("changes only the folder itself when the cascade is not requested", async () => {
    const f = fakeOps(sampleFolders());
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(false));
    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(r.ok && r.value.changed).toEqual([]);
    expect(r.ok && r.value.cascaded).toBe(false);
  });

  it("applies to every visible descendant, flagging the ones it ADOPTED", async () => {
    const f = fakeOps(sampleFolders());
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.calls).toHaveLength(3); // the parent + two descendants
    expect(r.value.changed).toEqual([
      { name: "Kept", adopted: false },
      { name: "Engeneering", adopted: true },
    ]);
    expect(r.value.failed).toEqual([]);
    expect(cascadeIsPartial(r.value)).toBe(false);
  });

  it("PRODUCES a non-empty `failed` when a descendant is refused — and reads as partial", async () => {
    // The banner's warning/success switch is driven off this. Nothing else in
    // the suite ever produced a real refusal, so inverting that switch used to
    // render a half-done cascade GREEN with every test still passing.
    const f = fakeOps(sampleFolders(), { refuse: ["Engeneering"] });
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.changed).toEqual([{ name: "Kept", adopted: false }]);
    expect(r.value.failed).toEqual([
      { name: "Engeneering", reason: "only the folder's owner can manage its sharing" },
    ]);
    expect(cascadeIsPartial(r.value)).toBe(true);
    expect(cascadeSummary(r.value)).toContain("NOT changed");
  });

  it("returns the server's own error when the folder ITSELF is refused, cascading nothing", async () => {
    const f = fakeOps(sampleFolders(), { refuse: ["Parent"] });
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(true));
    expect(r.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it("still changes the folder when the subtree cannot be listed, and says so", async () => {
    const f = fakeOps(sampleFolders(), { listFails: "the folder list is unavailable" });
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(f.calls).toHaveLength(1);
    expect(r.value.unreachable).toBe("the folder list is unavailable");
    expect(r.value.failed).toEqual([]);
    expect(cascadeIsPartial(r.value)).toBe(true);
  });

  it("REFUSES a subtree above the cap BEFORE changing anything (no half-applied tree)", async () => {
    // Unbounded, sequential and non-transactional: a big subtree can time out
    // mid-way in one serverless invocation, leaving the parent and N
    // descendants committed with no summary ever rendered. Refuse up front.
    const big: Folder[] = [
      build({ id: "1", parentId: null, ownerId: null, visibility: "org", name: "Root" }),
      build({ id: "2", parentId: "1", name: "Parent" }),
    ];
    for (let i = 0; i <= MAX_CASCADE; i++) {
      big.push(build({ id: `${100 + i}`, parentId: "2", name: `Child ${i}` }));
    }
    const f = fakeOps(big);
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(true));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("ValidationError");
    expect(r.error.message).toContain(String(MAX_CASCADE));
    expect(r.error.message).toContain("batches");
    expect(f.calls, "nothing may be written when the cascade is refused").toHaveLength(0);
  });

  it("does NOT apply the cap when no cascade was asked for", async () => {
    const big: Folder[] = [
      build({ id: "1", parentId: null, ownerId: null, visibility: "org", name: "Root" }),
      build({ id: "2", parentId: "1", name: "Parent" }),
    ];
    for (let i = 0; i <= MAX_CASCADE; i++) {
      big.push(build({ id: `${100 + i}`, parentId: "2", name: `Child ${i}` }));
    }
    const f = fakeOps(big);
    const r = await applyFolderVisibility(f.ops, cascadeActor, parentInput(false));
    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
});
