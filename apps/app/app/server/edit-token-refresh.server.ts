// The silent-refresh backend (ADR-0063 Phase 5) behind POST
// /api/v1/reports/{slug}/edit-token — a NEW token-minting surface, so this
// module is deliberately conservative and fails closed at every step.
//
// By the time `refreshEditToken` runs, SOMETHING has already resolved
// `actor` — in practice always `resolveEditTokenActor` (the LAST front door
// tried by `resolveUploadActor`, edit-token-actor.server.ts), which already
// re-verified the PRESENTED token's signature/scope/expiry/slug-match AND
// re-ran `loadWritableReport` LIVE once. This module runs the SAME
// `loadWritableReport` check a SECOND time, belt-and-braces — mirroring
// EXACTLY how reassembleAndSaveEditedVersion (save-edited-version.server.ts)
// re-checks canWrite even though its own callers already resolved a
// canWrite-derived actor: the second check is what protects a caller that
// somehow reaches this helper with an actor resolved via a DIFFERENT front
// door (defense in depth, not a redundant no-op) and is the single place
// "was this actor revoked since the last thing that checked?" is answered
// fresh, every time. `sub` on the newly-minted token is ALWAYS
// `actor.userId` from THIS re-check — never anything read off a
// caller-presented token's own claims (there IS no old-token input here at
// all — the route only ever hands this helper the ALREADY-authenticated
// actor + slug, ADR-0063 Phase 5 task brief).
//
// SECURITY TRADE-OFF (flagged for /security-review, operator-approved
// "sessions never break" design): making an edit token refreshable for as
// long as canWrite holds means a LEAKED token can also be refreshed,
// extending its effective life indefinitely (bounded only by how long the
// thief keeps calling this endpoint before the grant is revoked or
// ownership changes). Mitigations already in place, all independent of this
// module:
//   (a) single-report scope — the token only ever authorizes
//       `reports:write` on the ONE report it's bound to, never `acl:write`
//       (EDIT_TOKEN_SCOPES, auth.server.ts) — a thief can edit content, not
//       reshare/delete/move the report or touch any other report;
//   (b) the LIVE canWrite re-check right here — revoking a grant (or
//       transferring ownership) cuts the thief off within one remaining TTL
//       of their last successful refresh, not up to 24h;
//   (c) the token only ever leaves the app on the view origin's strict
//       edit-route CSP + sandboxed report iframe (ADR-0063 Decision 1 /
//       §F-1) — the control that's actually supposed to keep it out of an
//       attacker's reach in the first place.
// NOT implemented here, flagged as a recommendation rather than built (task
// brief: "don't necessarily build it"): an ABSOLUTE session cap — e.g.
// "never valid more than N hours after the very FIRST mint of this editing
// session, no matter how many times it's refreshed." Doing this cleanly
// would need a `sessionStartedAt` (or similar) claim threaded through every
// mint/refresh so refresh #2 still remembers refresh #1's origin, plus a cap
// check here comparing it against `nowSeconds()` — a real (if small) claims-
// shape + cross-cutting change to `EditClaims` (packages/domain/src/
// edit-token.ts), which this task was told NOT to touch. Left for the
// operator/security-review to weigh: is "revoked-grant-cuts-it-within-one-
// TTL" (b above) sufficient, or is a hard ceiling on total session length
// worth the added claims-shape complexity?
import {
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "arp-application";
import { type AppError, mintEditToken, ok, type Result, type Slug } from "arp-domain";

export interface RefreshEditTokenDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  /** The shared HMAC secret — the SAME one open-report.server.ts mints edit
   *  tokens under (`VIEW_ACCESS_TOKEN_SECRET` via `accessTokenSecret()`).
   *  Required (non-optional) here: the caller (the route) is responsible for
   *  the fail-closed "no secret configured → don't even attempt a refresh"
   *  decision BEFORE calling this helper, exactly like every other
   *  secret-gated flow in this codebase (edit-token-actor.server.ts,
   *  unlock.$slug.tsx) — this module stays free of env access. */
  readonly secret: string;
  /** Suggested: the SAME `EDIT_TTL_SECONDS` open-report.server.ts mints
   *  under (900s / 15 min) — a refresh should not grant a longer-lived
   *  capability than a fresh mint would. */
  readonly ttlSeconds: number;
  /** epoch seconds (injectable for tests). */
  readonly nowSeconds: () => number;
}

export interface RefreshedEditToken {
  readonly editToken: string;
  /** epoch seconds. */
  readonly expiresAt: number;
}

/**
 * Re-mint a fresh edit token for `actor` on `slug` — denied (no token
 * issued) unless `actor` STILL passes the live `canWrite` gate right now
 * (`isOwner OR hasWriteGrant`, ADR-0060 §4). See the module doc for the full
 * security-trade-off writeup.
 */
export async function refreshEditToken(
  deps: RefreshEditTokenDeps,
  actor: TenancyActor,
  slug: Slug,
): Promise<Result<RefreshedEditToken, AppError>> {
  const writable = await loadWritableReport(deps.reports, actor, slug, deps);
  if (!writable.ok) return writable; // revoked grant / lost ownership / deleted / not found → refresh denied

  const nowSeconds = deps.nowSeconds();
  const editToken = mintEditToken(slug, actor.userId, deps.ttlSeconds, deps.secret, nowSeconds);
  return ok({ editToken, expiresAt: nowSeconds + deps.ttlSeconds });
}
