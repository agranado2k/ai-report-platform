// Folder sharing, as the DASHBOARD sees it (ADR-0076 §6 — the deferred UI).
//
// Everything here lives on the SERVER on purpose. The dashboard's sidebar
// components must never import `arp-domain` (its barrel pulls `node:crypto`
// into the client bundle), so every domain-derived decision the sidebar
// renders — "may I manage this folder?", "which badge?", "what would the
// cascade actually do?" — is computed here and handed to the components as
// plain data. The `.server.ts` suffix is what keeps this module out of the
// client build, which is what lets it import `arp-domain` freely.
//
// The management rule is NOT re-derived here. `canManageFolder` /
// `hasFolderManagementScope` / `isRootFolder` are the same domain predicates
// `loadManagedFolder` enforces (packages/application/src/load-owned.ts), so
// the UI and the server cannot drift: a control this module enables is a
// control the use case will accept, and vice versa.

import { FOLDER_NOT_MANAGEABLE } from "arp-application";
import {
  type AppError,
  canManageFolder,
  collectFolderDescendants,
  err,
  type Folder,
  type FolderId,
  type FolderVisibility,
  folderIdToWire,
  graftOrphansToRoot,
  hasFolderManagementScope,
  isRootFolder,
  makeFolderId,
  type OrgId,
  ok,
  type Result,
  type UserId,
  validationError,
} from "arp-domain";
import type { BadgeTone } from "arp-ui";

/** The Root is not a manageable folder (ADR-0076 §3): the domain rejects a
 *  visibility call on it in EITHER direction and `shareFolder` refuses it, so
 *  the sidebar renders no controls for it at all rather than
 *  rendering-then-erroring. */
export const ROOT_REASON =
  "The Root folder is always visible to everyone in your org and can't be shared or owned.";

/** The 403 `loadManagedFolder` returns, said in the UI's voice — DERIVED from
 *  the application layer's own constant so the sentence a member reads is the
 *  sentence the server would have given them. */
export const NON_OWNER_REASON = `${FOLDER_NOT_MANAGEABLE.charAt(0).toUpperCase()}${FOLDER_NOT_MANAGEABLE.slice(1)}.`;

/** No resolved actor — a signed-out or degraded dashboard render. */
export const NO_ACTOR_REASON = "Sign in to change this folder's sharing.";

/** The `acl:write` gate every management use case applies first (ADR-0016).
 *  Not every actor that can reach the dashboard carries it — an edit-token
 *  actor holds `reports:write` only (ADR-0063) — and a control rendered live
 *  for such a session would POST straight into a 403. */
export const NO_SCOPE_REASON = "This session isn't allowed to change folder sharing.";

/** Shown BEFORE the first management action on a LEGACY folder (ADR-0076 §6):
 *  `setFolderVisibility` ADOPTS an owner-less folder, permanently, and there is
 *  no transfer path — so the warning has to arrive before the click, not as an
 *  explanation afterwards. */
export const ADOPTION_NOTICE =
  "You'll become this folder's owner. Other members won't be able to change its sharing, " +
  "and ownership can't be transferred.";

/** A share is accepted for ANY email but is INERT outside the folder's org:
 *  folder listings are org-scoped, so a grantee whose account lives elsewhere
 *  never sees the folder. Same promise the OpenAPI + MCP descriptions make. */
export const INERT_SHARE_NOTICE =
  "A share only works for someone in your org — folder listings are org-scoped, so an outside " +
  "address is recorded but sees nothing until they join.";

/** The roster load FAILED (a transient DB error, or an actor without
 *  `acl:write`). The panel must say so out loud: an empty roster rendered in
 *  its place would be a positive claim about who can see the folder, made from
 *  no data at all. */
export const ROSTER_UNAVAILABLE_NOTICE =
  "We couldn't load this folder's share list, so nothing here says who it's shared with. " +
  "Reload to try again.";

/**
 * The most descendants one cascade may cover (ADR-0076 §cascade).
 *
 * The cascade is a sequential, non-transactional loop: each iteration is a
 * `loadManagedFolder` plus a `uow.run(save + audit)` — three-plus serialized
 * round trips — and it all happens inside ONE serverless invocation. Depth is
 * capped at 8 but breadth is not, and there is no per-org folder quota, so a
 * wide subtree can exhaust the invocation mid-loop: the parent and N
 * descendants commit, `cascadeSummary` never runs, and the operator gets a 504
 * with no idea what changed. That is the one hole in the honesty story.
 *
 * 50 keeps the worst case (~3 round trips × 50) comfortably inside a single
 * invocation's budget while being far above any real folder tree today. Past
 * it we REFUSE up front rather than truncate silently — a truncated cascade
 * that reports success is exactly the lie this whole module exists to avoid.
 */
export const MAX_CASCADE = 50;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const folders = (n: number) => `${n} ${plural(n, "folder", "folders")}`;

export interface FolderBadge {
  readonly label: string;
  readonly tone: BadgeTone;
  /** The whole claim, in a sentence — rendered as the badge's `title`. The
   *  label has to survive a 14rem sidebar next to a truncating folder name, so
   *  the nuance lives here rather than being cut out of the label. */
  readonly title: string;
}

/** The sidebar's visibility badge. `shareCount` is `null` when the roster was
 *  not loaded for this folder (the loader only pays for the roster of the
 *  folder actually being managed) — and an unknown roster must never be
 *  rendered as a positive privacy claim, neither as "Shared with 0" nor as a
 *  flat "Private". A private folder MAY have individual grantees; all this row
 *  actually knows is that the whole org can't see it.
 *
 *  The unknown state reads `Limited` (2026-08-03 dogfood, I-1). Its first
 *  wording, `Not org-visible`, was honest and unreadable: a double negative,
 *  three times the width of `Org`, which truncated a 16-character folder name
 *  to "dog…" — and the SAME folder badged `Private` once its panel was opened,
 *  so one folder showed two labels depending on where you looked. `Limited`
 *  keeps the honesty (it claims only that the whole org can't see it, never
 *  that nobody else can) at `Private`'s width, and the `title` says the rest.
 *  The real fix is the batched share-count port method (issue #236), which
 *  would let every row badge accurately; this is the interim. */
export function folderVisibilityBadge(input: {
  readonly visibility: FolderVisibility;
  readonly shareCount: number | null;
}): FolderBadge {
  // Org visibility dominates: a folder everyone can see is not meaningfully
  // "shared with 3", and the broader state is the one worth surfacing.
  if (input.visibility === "org") {
    return {
      label: "Org",
      tone: "warning",
      title: "Everyone in your org can see this folder.",
    };
  }
  if (input.shareCount === null) {
    return {
      label: "Limited",
      tone: "neutral",
      title:
        "Not visible to your whole org. Open this folder's sharing menu to see who it's " +
        "shared with individually.",
    };
  }
  if (input.shareCount > 0) {
    return {
      label: `Shared with ${input.shareCount}`,
      tone: "brand",
      title: `Not visible to your whole org — shared with ${plural(input.shareCount, "1 person", `${input.shareCount} people`)}.`,
    };
  }
  return {
    label: "Private",
    tone: "neutral",
    title: "Only you can see this folder — it isn't shared with anyone.",
  };
}

/** A folder as the sidebar tree and the cascade both need it: wire ids, the
 *  display name, and the two domain facts every decision below turns on. */
export interface FolderTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly visibility: FolderVisibility;
  /** null = a legacy (pre-ADR-0076) row. Never sent to the client. */
  readonly ownerId: string | null;
}

/**
 * The viewer's folder tree, built ONCE (ADR-0076 §partial-visibility).
 *
 * Wire-encode the ids, then graft the visibility orphans under Root: a visible
 * folder whose ancestor chain contains an invisible folder is re-parented so it
 * stays reachable without leaking any invisible ancestor's name.
 *
 * The graft is not cosmetic for the cascade — it decides SCOPE. "Everything
 * inside this folder" has to mean exactly what the sidebar SHOWS inside it, so
 * the loader and the cascade must walk the same grafted tree. They used to
 * build it twice, 190 lines apart.
 */
export function visibleFolderTree(items: readonly Folder[]): readonly FolderTreeNode[] {
  const nodes: FolderTreeNode[] = items.map((f) => ({
    id: folderIdToWire(f.id),
    parentId: f.parentId ? folderIdToWire(f.parentId) : null,
    name: f.name,
    visibility: f.visibility,
    ownerId: f.ownerId,
  }));
  const rootId = nodes.find((n) => n.parentId === null)?.id;
  return rootId ? graftOrphansToRoot(nodes, rootId) : nodes;
}

/** What a cascade from this folder would actually touch — computed from the
 *  viewer's VISIBLE tree, which is the whole story about scope (a descendant
 *  the actor cannot see was never a candidate). */
export interface CascadeScope {
  /** The descendant ids, in breadth-first order. */
  readonly ids: readonly string[];
  readonly total: number;
  /** Descendants with no owner — a cascade ADOPTS every one of them. */
  readonly legacy: number;
  /** Descendants currently `private` — what an ORG cascade would expose. */
  readonly currentlyPrivate: number;
}

export function cascadeScope(tree: readonly FolderTreeNode[], folderWireId: string): CascadeScope {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const ids = collectFolderDescendants(tree, folderWireId);
  let legacy = 0;
  let currentlyPrivate = 0;
  for (const id of ids) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.ownerId === null) legacy += 1;
    if (node.visibility === "private") currentlyPrivate += 1;
  }
  return { ids, total: ids.length, legacy, currentlyPrivate };
}

/** The acting principal, as the rendering decisions need it. */
export interface ManagementActor {
  readonly userId: UserId;
  readonly scopes: readonly string[];
}

export interface FolderManagement {
  /** The Root. Render no management controls at all. */
  readonly isRoot: boolean;
  /** Would `loadManagedFolder` + the `acl:write` gate let this actor manage it? */
  readonly manageable: boolean;
  /** `ownerId === null` — a pre-ADR-0076 row, adoptable by anyone. */
  readonly legacy: boolean;
  /** Why the controls are disabled, or null when they aren't. */
  readonly blockedReason: string | null;
}

/** Would the four ADR-0076 management use cases accept this actor on this
 *  folder? Every leg is the DOMAIN predicate the use cases themselves apply,
 *  in the same order, so the answer is the server's and not the UI's. */
export function folderManagement(folder: Folder, actor: ManagementActor | null): FolderManagement {
  const legacy = folder.ownerId === null;
  const blocked = (blockedReason: string): FolderManagement => ({
    isRoot: isRootFolder(folder),
    manageable: false,
    legacy,
    blockedReason,
  });
  if (isRootFolder(folder)) return blocked(ROOT_REASON);
  // The dashboard degrades to a read-only render rather than a 500.
  if (!actor) return blocked(NO_ACTOR_REASON);
  if (!hasFolderManagementScope(actor.scopes)) return blocked(NO_SCOPE_REASON);
  if (!canManageFolder(folder, actor.userId)) return blocked(NON_OWNER_REASON);
  return { isRoot: false, manageable: true, legacy, blockedReason: null };
}

/**
 * THE WARNING, and there is only one of it (ADR-0076 §6 + §cascade).
 *
 * Adoption is permanent and has no transfer path, and migration 0019 left
 * EVERY pre-ADR-0076 folder with `owner_id` NULL — so legacy is the common
 * state, not an edge case, and the folder a member cascades from is very often
 * their own while the folders INSIDE it are not. Warning only about the folder
 * that was clicked meant a member could seize permanent ownership of every
 * legacy folder beneath it, in silence, and then watch colleagues 403 on
 * managing (and lose rename/delete/create-children on) folders they had used
 * for years.
 *
 * The org direction has its own hazard: the same checkbox PUBLISHES
 * currently-private descendants, and re-cascading `private` afterwards cannot
 * restore them individually because their per-descendant state is gone.
 *
 * All of it goes in ONE amber notice above the toggle — one warning surface,
 * stated BEFORE the click, never two competing ones.
 */
export function folderShareWarning(input: {
  /** Is the folder being acted on itself legacy? */
  readonly legacy: boolean;
  /** Where the toggle would take it. */
  readonly target: FolderVisibility;
  readonly scope: CascadeScope;
}): string | null {
  const lines: string[] = [];
  if (input.legacy) lines.push(ADOPTION_NOTICE);

  if (input.scope.total > MAX_CASCADE) {
    // The cascade is off entirely at this size, so the adoption/exposure
    // warnings below describe something that cannot happen — say why instead.
    lines.push(
      `This folder has ${folders(input.scope.total)} inside it, more than the ${MAX_CASCADE} ` +
        "one change can cover, so applying to everything inside is unavailable here — " +
        "work through them in batches.",
    );
    return lines.length > 0 ? lines.join(" ") : null;
  }

  if (input.scope.legacy > 0) {
    const n = input.scope.legacy;
    lines.push(
      `You'll also become the owner of ${folders(n)} inside this one that ` +
        "nobody owns yet, if you apply the change to everything inside — permanently, and " +
        `other members will no longer be able to change ${plural(n, "its", "their")} sharing.`,
    );
  }
  if (input.target === "org" && input.scope.currentlyPrivate > 0) {
    // Every clause has to agree with the count, not just the noun: the first
    // version singularised "1 folder" and then said "that ARE currently
    // private … won't put THEM back" (2026-08-03 dogfood, I-3).
    const n = input.scope.currentlyPrivate;
    lines.push(
      `Applying to everything inside will also make ${folders(n)} ` +
        `that ${plural(n, "is", "are")} currently private visible to everyone in your org; ` +
        `making this folder private again won't put ${plural(n, "it", "them")} back.`,
    );
  }
  return lines.length > 0 ? lines.join(" ") : null;
}

/** The cascade checkbox's label — direction-aware and counted, because "also
 *  apply to everything inside this folder" said the same thing whether it was
 *  about to hide two folders or publish twenty. `null` means render no
 *  checkbox at all: there is nothing inside, or the subtree is over the cap. */
export function cascadeLabel(input: {
  readonly target: FolderVisibility;
  readonly scope: CascadeScope;
}): string | null {
  const n = input.scope.total;
  if (n === 0 || n > MAX_CASCADE) return null;
  const subject = `the ${folders(n)} inside this one`;
  return input.target === "private"
    ? `Also make ${subject} private`
    : `Also share ${subject} with the whole org`;
}

export interface CascadeFailure {
  readonly name: string;
  readonly reason: string;
}

export interface CascadeChange {
  readonly name: string;
  /** Did this change ADOPT the folder (it had no owner until now)? */
  readonly adopted: boolean;
}

export interface CascadeOutcome {
  readonly visibility: FolderVisibility;
  /** The DESCENDANTS that were actually re-saved. */
  readonly changed: readonly CascadeChange[];
  /** Descendants that were refused, each with the server's own reason. */
  readonly failed: readonly CascadeFailure[];
  /** Did the operator tick "also apply to everything inside"? */
  readonly cascaded: boolean;
  /** Set when the subtree could not be ENUMERATED at all — the folder itself
   *  still changed, but nothing inside was even examined. Distinct from a
   *  refusal: there is no count to report, and inventing one was the bug. */
  readonly unreachable: string | null;
}

/** Is this outcome anything less than a clean success? The banner's
 *  warning-vs-success switch reads this, rather than re-deriving the condition
 *  at the call site where inverting it would go unnoticed. */
export function cascadeIsPartial(outcome: CascadeOutcome): boolean {
  return outcome.failed.length > 0 || outcome.unreachable !== null;
}

/** The one sentence the dashboard shows after a visibility change. ADR-0076's
 *  repair is PER-FOLDER, and the cascade is a UI-layer loop over the same use
 *  case — so a partial failure is normal, and this must never round it up into
 *  a success. Every refused folder is named with the reason the server gave,
 *  and every ADOPTED folder is named as an adoption, not as an ordinary change. */
export function cascadeSummary(outcome: CascadeOutcome): string {
  const head = `Set to ${outcome.visibility}.`;
  if (!outcome.cascaded) return head;
  if (outcome.unreachable !== null) {
    return `${head} The folders inside this one could not be checked (${outcome.unreachable}) — nothing inside was changed.`;
  }

  const applied =
    outcome.changed.length > 0
      ? `Set to ${outcome.visibility}, and applied to ${folders(outcome.changed.length)} inside: ${outcome.changed
          .map((c) => c.name)
          .join(", ")}.`
      : head;
  const adopted = outcome.changed.filter((c) => c.adopted);
  const adoptedTail =
    adopted.length > 0
      ? ` You're now the owner of ${adopted.length} of them: ${adopted.map((c) => c.name).join(", ")}.`
      : "";
  const failedTail =
    outcome.failed.length > 0
      ? ` ${outcome.failed.length} ${plural(outcome.failed.length, "folder was", "folders were")} NOT changed: ${outcome.failed
          .map((f) => `${f.name} (${f.reason})`)
          .join(", ")}.`
      : "";
  if (outcome.changed.length === 0 && failedTail === "") {
    return `${head} Nothing inside this folder needed changing.`;
  }
  return `${applied}${adoptedTail}${failedTail}`;
}

/** The acting principal the three ADR-0076 management use cases authorize
 *  against — `TenancyActor` plus the `acl:write` scope they all gate on. */
export interface FolderManagementActor {
  readonly orgId: OrgId;
  readonly userId: UserId;
  readonly scopes: readonly string[];
}

/** The two `ops()` calls the cascade makes, as an injected seam — this is what
 *  makes the riskiest code in the feature unit-testable at all (it used to
 *  live in a route module, which no test tier collects). */
export interface CascadeOps {
  listFolders(
    actor: { readonly orgId: OrgId; readonly userId: UserId },
    input: Record<string, never>,
  ): Promise<Result<{ readonly items: readonly Folder[] }, AppError>>;
  setFolderVisibility(
    actor: FolderManagementActor,
    input: { readonly folderId: FolderId; readonly visibility: FolderVisibility },
  ): Promise<Result<Folder, AppError>>;
}

export interface ApplyFolderVisibilityInput {
  /** The wire id, as the tree and the form both carry it. */
  readonly folderWireId: string;
  readonly folderId: FolderId;
  readonly visibility: FolderVisibility;
  readonly cascade: boolean;
}

/**
 * Set a folder's visibility, optionally cascading into everything inside it
 * (ADR-0076 §cascade — the nested-folder gap).
 *
 * ADR-0076's repair is per-folder and NOT recursive: making a parent private
 * leaves pre-existing descendants org-visible, and `graftOrphansToRoot` then
 * re-parents them under Root in other members' sidebars — so their names still
 * leak from a folder its owner believes they just made private.
 *
 * This closes that gap WITHOUT changing the model: a loop over the actor's
 * VISIBLE tree, calling the SAME `setFolderVisibility` use case once per
 * descendant. No recursive domain transition, no recursive SQL, no new
 * authorization path — every iteration re-runs `loadManagedFolder`, so a
 * descendant this actor doesn't own is refused by the server exactly as it
 * would be on its own.
 *
 * Order matters:
 *  1. Enumerate FIRST, so an oversized subtree is refused before anything is
 *     written (a half-applied tree with no summary is the failure mode).
 *  2. Then the folder itself — if IT fails there is nothing to cascade.
 *  3. Then the descendants, one authorized, audited call each.
 */
export async function applyFolderVisibility(
  ops: CascadeOps,
  actor: FolderManagementActor,
  input: ApplyFolderVisibilityInput,
): Promise<Result<CascadeOutcome, AppError>> {
  let scope: CascadeScope | null = null;
  let byId = new Map<string, FolderTreeNode>();
  let unreachable: string | null = null;

  if (input.cascade) {
    const listed = await ops.listFolders({ orgId: actor.orgId, userId: actor.userId }, {});
    if (listed.ok) {
      const tree = visibleFolderTree(listed.value.items);
      byId = new Map(tree.map((n) => [n.id, n]));
      scope = cascadeScope(tree, input.folderWireId);
      if (scope.total > MAX_CASCADE) {
        return err(
          validationError(
            `this folder has ${folders(scope.total)} inside it — more than the ${MAX_CASCADE} one change can cover. Nothing was changed; apply it in batches, starting with the folders inside.`,
            "cascade",
          ),
        );
      }
    } else {
      // We cannot enumerate, so we cannot cap-check or name anything inside.
      // Still change the folder ITSELF (making a folder private is the safe
      // direction, and blocking it on a transient list failure helps nobody),
      // then say plainly that the inside was never examined.
      unreachable = listed.error.message;
    }
  }

  const own = await ops.setFolderVisibility(actor, {
    folderId: input.folderId,
    visibility: input.visibility,
  });
  if (!own.ok) return own;

  const changed: CascadeChange[] = [];
  const failed: CascadeFailure[] = [];
  for (const descendantId of scope?.ids ?? []) {
    const node = byId.get(descendantId);
    const name = node?.name ?? descendantId;
    // The id came out of `folderIdToWire` moments ago, so this decode is a
    // belt-and-braces round-trip; a failure is reported per-folder like any
    // other refusal rather than aborting the loop.
    const decoded = makeFolderId(descendantId);
    if (!decoded.ok) {
      failed.push({ name, reason: decoded.error.message });
      continue;
    }
    const r = await ops.setFolderVisibility(actor, {
      folderId: decoded.value,
      visibility: input.visibility,
    });
    if (r.ok) changed.push({ name, adopted: node?.ownerId === null });
    else failed.push({ name, reason: r.error.message });
  }

  return ok({
    visibility: input.visibility,
    changed,
    failed,
    cascaded: input.cascade,
    unreachable,
  });
}
