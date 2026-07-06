import type { FolderId, OrgId, UserId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { principalToUploadActor } from "./api-key-principal";

describe("principalToUploadActor", () => {
  it("maps ApiKeyPrincipal onto UploadActor, renaming rootFolderId to folderId", () => {
    const actor = principalToUploadActor({
      userId: "user-1" as UserId,
      orgId: "org-1" as OrgId,
      rootFolderId: "folder-root" as FolderId,
      scopes: ["reports:write", "folders:write"],
    });
    expect(actor).toEqual({
      userId: "user-1",
      orgId: "org-1",
      folderId: "folder-root",
      scopes: ["reports:write", "folders:write"],
    });
  });

  it("passes scopes through untouched (ADR-0016 — from the key row, never hardcoded)", () => {
    const actor = principalToUploadActor({
      userId: "user-1" as UserId,
      orgId: "org-1" as OrgId,
      rootFolderId: "folder-root" as FolderId,
      scopes: [],
    });
    expect(actor.scopes).toEqual([]);
  });
});
