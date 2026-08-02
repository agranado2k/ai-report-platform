// Folder sharing, as the DASHBOARD sees it (ADR-0076 §6 — the deferred UI).
//
// Everything here is pure and lives on the SERVER on purpose. The dashboard's
// sidebar components must never import `arp-domain` (its barrel pulls
// `node:crypto` into the client bundle), so every domain-derived decision the
// sidebar renders — "may I manage this folder?", "which badge?", "what does the
// cascade actually claim?" — is computed in the loader/action and handed to the
// components as plain data.
//
// The management rule is a MIRROR of `loadManagedFolder` (packages/application/
// src/load-owned.ts) plus the domain's Root refusal (`setFolderVisibility` in
// arp-domain rejects ANY visibility call on a folder with `parentId === null`).
// It is deliberately not a second, independently-invented rule: the server is
// still the authority, and every control this module enables posts to the same
// use case, which re-checks. What this buys is that the UI never renders an
// affordance the server will refuse.

import type { BadgeTone } from "arp-ui";

/** Who can see a folder — the `FolderVisibility` wire values (ADR-0076),
 *  restated here so this module (and the components it feeds) never has to
 *  import `arp-domain`. */
export type FolderVisibilityWire = "private" | "org";

/** The Root is not a manageable folder (ADR-0076 §3): the domain rejects a
 *  visibility call on it in EITHER direction, so the sidebar renders no
 *  controls for it at all rather than rendering-then-erroring. */
export const ROOT_REASON =
  "The Root folder is always visible to everyone in your org and can't be shared or owned.";

/** The 403 `loadManagedFolder` returns, said in the UI's voice. */
export const NON_OWNER_REASON = "Only the folder's owner can change its sharing.";

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

export interface FolderBadge {
  readonly label: string;
  readonly tone: BadgeTone;
}

/** The sidebar's visibility badge. `shareCount` is `null` when the roster was
 *  not loaded for this folder (the loader only pays for the roster of the
 *  folder actually being managed) — an unknown count must never be rendered
 *  as "Shared with 0". */
export function folderVisibilityBadge(input: {
  readonly visibility: FolderVisibilityWire;
  readonly shareCount: number | null;
}): FolderBadge {
  // Org visibility dominates: a folder everyone can see is not meaningfully
  // "shared with 3", and the broader state is the one worth surfacing.
  if (input.visibility === "org") return { label: "Org", tone: "warning" };
  if (input.shareCount !== null && input.shareCount > 0) {
    return { label: `Shared with ${input.shareCount}`, tone: "brand" };
  }
  return { label: "Private", tone: "neutral" };
}

export interface FolderManagement {
  /** `parentId === null` — the Root. Render no management controls at all. */
  readonly isRoot: boolean;
  /** Would `loadManagedFolder` let this actor manage this folder? */
  readonly manageable: boolean;
  /** `ownerId === null` — a pre-ADR-0076 row, adoptable by anyone. */
  readonly legacy: boolean;
  /** Why the controls are disabled, or null when they aren't. */
  readonly blockedReason: string | null;
  /** The adoption warning to show BEFORE the first action, or null. */
  readonly adoptionNotice: string | null;
}

/** Mirror of `loadManagedFolder` + the Root refusal, for rendering decisions. */
export function folderManagement(
  folder: { readonly parentId: string | null; readonly ownerId: string | null },
  actorUserId: string | null,
): FolderManagement {
  const legacy = folder.ownerId === null;
  if (folder.parentId === null) {
    return {
      isRoot: true,
      manageable: false,
      legacy,
      blockedReason: ROOT_REASON,
      adoptionNotice: null,
    };
  }
  // No resolved actor (the dashboard degrades to a read-only render rather
  // than a 500) — nothing is manageable.
  if (actorUserId === null) {
    return {
      isRoot: false,
      manageable: false,
      legacy,
      blockedReason: NON_OWNER_REASON,
      adoptionNotice: null,
    };
  }
  if (legacy) {
    return {
      isRoot: false,
      manageable: true,
      legacy: true,
      blockedReason: null,
      adoptionNotice: ADOPTION_NOTICE,
    };
  }
  if (folder.ownerId === actorUserId) {
    return {
      isRoot: false,
      manageable: true,
      legacy: false,
      blockedReason: null,
      adoptionNotice: null,
    };
  }
  return {
    isRoot: false,
    manageable: false,
    legacy: false,
    blockedReason: NON_OWNER_REASON,
    adoptionNotice: null,
  };
}

export interface CascadeFailure {
  readonly name: string;
  readonly reason: string;
}

export interface CascadeOutcome {
  readonly visibility: FolderVisibilityWire;
  /** Names of the DESCENDANTS that were actually re-saved. */
  readonly changed: readonly string[];
  /** Descendants that were refused, each with the server's own reason. */
  readonly failed: readonly CascadeFailure[];
  /** Did the operator tick "also apply to everything inside"? */
  readonly cascaded: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The one sentence the dashboard shows after a visibility change. ADR-0076's
 *  repair is PER-FOLDER, and the cascade is a UI-layer loop over the same use
 *  case — so a partial failure is normal, and this must never round it up into
 *  a success. Every refused folder is named, with the reason the server gave. */
export function cascadeSummary(outcome: CascadeOutcome): string {
  const head = `Set to ${outcome.visibility}.`;
  if (!outcome.cascaded) return head;
  const parts: string[] = [];
  if (outcome.changed.length > 0) {
    parts.push(
      `and applied to ${outcome.changed.length} ${plural(outcome.changed.length, "folder", "folders")} inside: ${outcome.changed.join(", ")}`,
    );
  }
  const tail =
    outcome.failed.length > 0
      ? `${outcome.failed.length} ${plural(outcome.failed.length, "folder was", "folders were")} NOT changed: ${outcome.failed
          .map((f) => `${f.name} (${f.reason})`)
          .join(", ")}.`
      : "";
  if (parts.length === 0 && tail === "") {
    return `${head} Nothing inside this folder needed changing.`;
  }
  const first = parts.length > 0 ? `Set to ${outcome.visibility}, ${parts.join(" ")}.` : head;
  return tail === "" ? first : `${first} ${tail}`;
}
