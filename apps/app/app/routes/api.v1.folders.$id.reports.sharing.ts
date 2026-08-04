// POST /api/v1/folders/{id}/reports/sharing — apply a sharing state to the
// reports INSIDE a folder (ADR-0078 §5).
//
// This is the action that makes a shared folder reach its contents. It does NOT
// change the folder (POST /folders/{id}/visibility does that, ADR-0076) and it
// does not consult the folder at authorization time: it loops over the actor's
// VISIBLE reports in that folder and calls the per-report use case, which
// re-runs its own owner-only gate on every one of them.
//
// Always 200 on a completed run, carrying `changed` / `skipped` / `failed` in
// full — a bulk action that hid what it did not touch would be the one thing
// this surface exists to avoid. It 422s only when it refused PRE-FLIGHT (too
// many reports), in which case nothing was changed at all.
import { makeFolderId, makeReportSharingState } from "arp-domain";
import { applyFolderSharingToReportsToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = methods({
  POST: handle({
    mode: "write",
    parseBody: true,
    run: ({ args, actor, body }) => {
      const id = makeFolderId(String(args.params.id ?? ""));
      if (!id.ok) return id;
      const sharing = makeReportSharingState(typeof body.sharing === "string" ? body.sharing : "");
      if (!sharing.ok) return sharing;
      // No `idempotencyKey`: this op is a LOOP of individually
      // idempotent-in-effect state sets, and a replayed summary would describe
      // a run whose per-report outcomes no longer match reality (ADR-0078 §10).
      return ops().applyFolderSharingToReports(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        { folderId: id.value, sharing: sharing.value },
      );
    },
    toHttp: (result) => applyFolderSharingToReportsToHttp(result, wireContext()),
  }),
});
