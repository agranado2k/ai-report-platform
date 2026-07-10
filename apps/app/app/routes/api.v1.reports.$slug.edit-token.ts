// POST /api/v1/reports/{slug}/edit-token — the silent-refresh backend
// (ADR-0063 Phase 5): issue a FRESH edit token to a caller presenting a
// CURRENTLY-VALID one, so the unified in-viewer editing session can keep
// itself alive past the 15-min EDIT_TTL_SECONDS without bouncing the user
// back through GET /reports/{slug}/open. This is a NEW token-minting
// surface — deliberately conservative, fails closed at every step; see
// edit-token-refresh.server.ts's module doc for the full security-trade-off
// writeup (a leaked token is also refreshable while canWrite holds — an
// operator-approved "sessions never break" choice, with mitigations and a
// flagged-not-built recommendation for an absolute session cap).
//
// Auth: the SAME seam as every other edit-token-authenticatable route on
// this API (diff.ts, versions.ts) — `handle({ mode: "write" })` resolves
// `actor` via `resolveUploadActor`, whose LAST front door is
// `resolveEditTokenActor`: it verifies the presented token's signature/
// scope/expiry/slug-match AND re-checks `canWrite` LIVE before `actor` even
// exists in `run()` below (edit-token-actor.server.test.ts covers every
// failure mode of THAT boundary — expired/tampered/wrong-secret/wrong-slug/
// cross-parsed-access-token/revoked-canWrite tokens all resolve to `null`
// there, which surfaces here as 401 before this route's own code runs at
// all). `refreshEditToken` then re-runs `loadWritableReport` a SECOND time,
// belt-and-braces, exactly like `reassembleAndSaveEditedVersion` does for
// saves (save-edited-version.server.ts) — see that module's doc comment for
// why a second check is defense-in-depth, not a redundant no-op. `sub` on
// the newly-minted token is always THIS re-checked actor's `userId`, never
// anything read off the old token's own claims (there is no old-token input
// to this route at all — only the already-authenticated actor + slug).
//
// CORS (ADR-0063): wrapped in `corsRoute` — see
// api.v1.reports.$slug.versions.ts's header comment for the full rationale
// (Bearer-header auth, no credentials, OPTIONS answered before any auth
// runs). This resource has no GET; the `loader` export exists ONLY to
// answer the OPTIONS preflight (React-Router routes any OPTIONS to
// `loader`, never `action`) and otherwise 405s, mirroring
// api.v1.reports.$slug.comments.$comment_id.ts's PATCH/DELETE-only route.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { err, methodNotAllowed } from "arp-domain";
import { errorToHttp, refreshEditTokenToHttp } from "arp-http";
import {
  accessTokenSecret,
  deps,
  identityStore,
  writeGrantStore,
} from "../server/container.server";
import { corsRoute } from "../server/cors.server";
import { refreshEditToken } from "../server/edit-token-refresh.server";
import { handle } from "../server/handle.server";
import { toResponse } from "../server/http.server";
import { EDIT_TTL_SECONDS } from "../server/open-report.server";

const ALLOWED_METHODS = "POST, OPTIONS";

export const loader = corsRoute(ALLOWED_METHODS, async (_args: LoaderFunctionArgs) =>
  toResponse(errorToHttp(methodNotAllowed("POST"))),
);

export const action = corsRoute(
  ALLOWED_METHODS,
  handle({
    mode: "write",
    slug: true,
    run: ({ actor, slug }) => {
      const secret = accessTokenSecret();
      if (!secret) {
        // No secret configured (previews/dev): no token is ever trusted OR
        // minted, the same fail-closed posture resolveEditTokenActor itself
        // takes. In practice unreachable — an edit-token actor can only
        // have been resolved AT ALL when a secret exists — but kept
        // explicit rather than assumed, since `actor` here isn't
        // structurally guaranteed to have come through that front door.
        return err({ kind: "Unauthenticated", message: "private viewing is not configured" });
      }
      return refreshEditToken(
        {
          reports: deps().reports,
          grants: writeGrantStore(),
          identities: identityStore(),
          secret,
          ttlSeconds: EDIT_TTL_SECONDS,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        },
        actor,
        slug,
      );
    },
    toHttp: (result) => refreshEditTokenToHttp(result),
  }),
);
