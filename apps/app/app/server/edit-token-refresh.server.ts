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
// SECURITY TRADE-OFF (originally flagged for /security-review, operator-
// approved "sessions never break" design, now amended): making an edit token
// refreshable for as long as canWrite holds means a LEAKED token can also be
// refreshed, extending its effective life — bounded only by how long the
// thief keeps calling this endpoint before the grant is revoked, ownership
// changes, OR (as of this module) the ABSOLUTE SESSION CAP below fires.
// Mitigations in place:
//   (a) single-report scope — the token only ever authorizes
//       `reports:write` on the ONE report it's bound to, never `acl:write`
//       (EDIT_TOKEN_SCOPES, auth.server.ts) — a thief can edit content, not
//       reshare/delete/move the report or touch any other report;
//   (b) the LIVE canWrite re-check right here — revoking a grant (or
//       transferring ownership) cuts the thief off within one remaining TTL
//       of their last successful refresh;
//   (c) the token only ever leaves the app on the view origin's strict
//       edit-route CSP + sandboxed report iframe (ADR-0063 Decision 1 /
//       §F-1) — the control that's actually supposed to keep it out of an
//       attacker's reach in the first place;
//   (d) THE ABSOLUTE SESSION CAP (`SESSION_CAP_SECONDS`, new): (b) alone
//       bounds a REVOKED grant to within one TTL, but does nothing for a
//       grant that's NEVER revoked (e.g. an owner's own report) — there, a
//       leaked token could previously be refreshed forever. This module now
//       reads the PRESENTED edit token's `sessionStart` claim (the epoch
//       second of the very FIRST mint of this refresh chain,
//       packages/domain/src/edit-token.ts) and denies the refresh once
//       `now - sessionStart >= SESSION_CAP_SECONDS`, regardless of
//       revocation state. A successful refresh mints the new token carrying
//       that SAME `sessionStart` forward (never reset to now), so the WHOLE
//       chain is bounded by one hard ceiling. A caller that did not present
//       an edit token at all (resolved `actor` via Clerk session / `arp_`
//       API key / OAuth token instead — the documented finding-#1
//       Clerk/API-key breadth this route intentionally still allows, see
//       the route's own header comment) has no prior chain to bound, so this
//       refresh simply STARTS a fresh session (`sessionStart = now`) — those
//       credentials aren't the leaked-bearer-token risk this cap targets; a
//       Clerk session's own auth is re-verified per call and an `arp_` key
//       is independently revocable. See `resolvePresentedSession` below for
//       how the route recovers which case it's in.
import {
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "arp-application";
import {
  type AppError,
  err,
  mintEditToken,
  notAllowed,
  ok,
  type Result,
  readEditToken,
  type Slug,
} from "arp-domain";
import { bearerToken } from "./edit-token-actor.server";

/** 8h — a full workday of continuous editing. Beyond it, a refresh is denied
 *  no matter how healthy the underlying write grant is; the user re-opens
 *  the report (`GET /reports/{slug}/open`) to mint a genuinely fresh
 *  session. Deliberately generous (not a short idle timeout) — this bounds
 *  TOTAL session length, not inactivity; the silent-refresh timer already
 *  keeps an ACTIVE session alive well under this, so a normal workday of use
 *  never hits it. */
export const SESSION_CAP_SECONDS = 8 * 60 * 60;

/**
 * What the caller presented, as recovered by `resolvePresentedSession` from
 * the raw `Authorization` header — resolved independently of however `actor`
 * itself got authenticated (any of the four `resolveUploadActor` front
 * doors), because only the PRESENTED edit token (if any) carries a
 * `sessionStart` to bound.
 */
export type PresentedSession =
  /** No edit token rode this request (a different front door authenticated
   *  `actor`) — there is no refresh chain to bound; treat this call as the
   *  start of a brand-new session. */
  | { readonly kind: "no-edit-token" }
  /** An edit token WAS presented and independently re-verified here.
   *  `sessionStart` is `undefined` only for a LEGACY token minted before this
   *  field existed (backward-compat window, packages/domain/src/
   *  edit-token.ts) — refreshEditToken denies that case rather than guess an
   *  age. */
  | { readonly kind: "edit-token"; readonly sessionStart: number | undefined };

/**
 * Recover the PRESENTED session's origin from the raw request, for the
 * absolute session cap. Reads the SAME `Authorization: Bearer` header
 * `resolveEditTokenActor` (edit-token-actor.server.ts) already consumed to
 * authenticate `actor` — re-parsed independently here because `handle()`'s
 * `WriteRunContext` only exposes the resolved `actor`, not the raw claims it
 * came from (ADR-0063 Phase 5 route design: `mode:"write"` intentionally
 * accepts any of four front doors, so the resolved actor alone can't tell us
 * whether an edit token was the one that authenticated it). A token that
 * fails to verify (expired/tampered/wrong-secret/wrong-slug/wrong-scope) is
 * treated identically to "no token presented" → a fresh session. This is NOT
 * an open door: a caller can only reach `run()` at all because a credential
 * ALREADY authenticated them (a failed-verify edit token authenticates
 * nothing — `handle()` 401s before `run()` unless a DIFFERENT front door,
 * Clerk/`arp_`/OAuth, succeeded), and the LIVE `canWrite` re-check in
 * `refreshEditToken` still gates whether ANY token is issued. The only effect
 * of the "fresh session" classification is that there's no prior refresh chain
 * to bound — correct, because there is none. Never throws.
 */
export function resolvePresentedSession(
  request: Request,
  slug: Slug,
  secret: string,
  nowSeconds: number,
): PresentedSession {
  const token = bearerToken(request);
  if (!token) return { kind: "no-edit-token" };
  const claims = readEditToken(token, slug, secret, nowSeconds);
  if (!claims) return { kind: "no-edit-token" };
  return { kind: "edit-token", sessionStart: claims.sessionStart };
}

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
 * issued) unless BOTH hold:
 *   1. `actor` STILL passes the live `canWrite` gate right now (`isOwner OR
 *      hasWriteGrant`, ADR-0060 §4), AND
 *   2. the ABSOLUTE SESSION CAP isn't exceeded — `presented` (from
 *      `resolvePresentedSession`) must be either a fresh session
 *      (`"no-edit-token"`) or a presented edit token whose `sessionStart` is
 *      known AND less than `SESSION_CAP_SECONDS` old.
 * A successful refresh mints the new token carrying `sessionStart` FORWARD
 * UNCHANGED (never reset to `nowSeconds`) — that's what makes the cap bound
 * the WHOLE chain, not just each individual hop. See the module doc for the
 * full security-trade-off writeup.
 */
export async function refreshEditToken(
  deps: RefreshEditTokenDeps,
  actor: TenancyActor,
  slug: Slug,
  presented: PresentedSession,
): Promise<Result<RefreshedEditToken, AppError>> {
  const writable = await loadWritableReport(deps.reports, actor, slug, deps);
  if (!writable.ok) return writable; // revoked grant / lost ownership / deleted / not found → refresh denied

  const nowSeconds = deps.nowSeconds();

  let sessionStart: number;
  if (presented.kind === "no-edit-token") {
    // No prior refresh chain to bound — this call STARTS a fresh session.
    sessionStart = nowSeconds;
  } else if (presented.sessionStart === undefined) {
    // Legacy edit token (minted before the session-cap field existed): its
    // true age is unknown, so fail closed rather than grant an unbounded
    // chain under the cap's own cover. The user re-opens the report to mint
    // a session the cap can actually track.
    return err(notAllowed("edit session predates the session cap; reopen the report to continue"));
  } else if (nowSeconds - presented.sessionStart >= SESSION_CAP_SECONDS) {
    // The chain has run for SESSION_CAP_SECONDS or more since its FIRST
    // mint — denied regardless of how healthy the write grant still is.
    return err(
      notAllowed("edit session exceeded the maximum session length; reopen the report to continue"),
    );
  } else {
    // Within the cap — carry the ORIGINAL session start forward unchanged.
    sessionStart = presented.sessionStart;
  }

  const editToken = mintEditToken(
    slug,
    actor.userId,
    deps.ttlSeconds,
    deps.secret,
    nowSeconds,
    sessionStart,
  );
  return ok({ editToken, expiresAt: nowSeconds + deps.ttlSeconds });
}
