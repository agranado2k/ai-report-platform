// POST /api/v1/reports/{slug}/sharing — set a report's three-state sharing
// (ADR-0078 §3): `private`, `org_view`, or `org_edit`.
//
// OWNER-ONLY + the `acl:write` scope, like every other sharing operation: each
// of these transitions is a `set_acl` plus an org-write decision, and `set_acl`
// is owner-only by ADR-0059 §2.
//
// Distinct from POST …/acl, which is NOT superseded: that route is where
// `password` and `allowlist` are configured, and it is the only way into them.
// This route is the coarse, safe control — three states, read and write always
// paired — and it deliberately REFUSES to leave an advanced mode without
// `confirm_discard`, so a client cannot delete a password by picking a radio
// button. Thin transport adapter over the `handle()` seam + `ops()`; the use
// case owns all authz.
import { makeReportSharingState } from "arp-domain";
import { setReportSharingToHttp } from "arp-http";
import { ops } from "../server/container.server";
import { handle, methods } from "../server/handle.server";
import { wireContext } from "../server/http.server";

export const action = methods({
  POST: handle({
    mode: "write",
    slug: true,
    parseBody: true,
    run: ({ actor, slug, body, idempotencyKey }) => {
      // ONE validator, shared with the dashboard action and the MCP tool
      // (arp-domain) — three copies of an enum check is how doors drift apart.
      const sharing = makeReportSharingState(typeof body.sharing === "string" ? body.sharing : "");
      if (!sharing.ok) return sharing;
      return ops().setReportSharing(
        { orgId: actor.orgId, userId: actor.userId, scopes: actor.scopes },
        {
          slug,
          sharing: sharing.value,
          // Strictly `=== true`: a truthy string ("false", "0") must not
          // silently authorize discarding a password.
          confirmDiscard: body.confirm_discard === true,
          idempotencyKey,
        },
      );
    },
    toHttp: (result, { actor }) =>
      setReportSharingToHttp(result, wireContext(), { userId: actor.userId }),
  }),
});
