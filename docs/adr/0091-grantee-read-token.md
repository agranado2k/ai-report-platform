# ADR-0091: The Grantee read token — a read capability for a write-grantee that is not `owner: true`

- **Status**: Accepted (2026-09-17) — **amends ADR-0089 §8**, which recorded this gap as a
  known limitation and deferred it to its own ticket; that section now points here rather
  than describing an open problem. Also extends ADR-0056 §1 (a second claim shape the app
  mints and the viewer verifies) and tightens the `Access token` parse of ADR-0063 §3.
- **Deciders**: operator
- **Date**: 2026-09-17
- **Relates to**: ADR-0063 (the Edit token, the capability-cookie pattern, and review
  #146 — the privilege escalation this record exists to avoid), ADR-0059 §4 (`/open` is
  the ONE mint and gates on `canWrite`), ADR-0060 (per-report write grants — the principal
  this record serves), ADR-0038/ADR-002 (the byte-for-byte canonical route and the
  credential-free viewer origin, both untouched), ADR-0069 (the trust boundary the
  view-origin half is argued against)

## Context and problem statement

ADR-0089 gave the report's owner first-party chrome around the byte-for-byte report: a
sandboxed iframe at `view.<domain>/<slug>/view` framing the canonical `GET /<slug>`. The
frame is a **real same-site navigation**, so it carries the path-scoped `arp_unlock`
cookie and nothing else — which is exactly why the design is safe, and exactly where it
runs out.

An **owner** gets that cookie because `/open` mints them an `oa` (owner-access
`Access token`, `owner: true`) alongside the Edit token, and the owner view redeems the
verified `oa` into `arp_unlock` (ADR-0089 §4c).

A **write-grantee** — a non-owner who holds `canWrite` on one report (ADR-0060) — is
**deliberately never minted one**. An `owner: true` claim for a non-owner is the exact
privilege escalation ADR-0063 review #146 caught: that claim bypasses *every* share gate
on the report, and it asserts something false about the principal. So the grantee reaches
the owner view with `capability: "write"` and full chrome, and the framed `GET /<slug>` is
then gated on its own merits. For a report in `private` / `password` / `allowlist` mode
the grantee gets **chrome around the unlock wall**.

ADR-0089 §8 recorded this and named the door — "a scope-bound, mode-independent read token
minted by the app, explicitly not `owner: true`" — as "a decision for its own ticket, not a
thing to improvise inside this route". This is that record.

It was not urgent while nothing routed anyone to the owner view by default. **#363 flips
owner-open**, which is what makes it reachable, and the two land together.

## Decision drivers

- **Never mint `owner: true` for a non-owner.** Not "never redeem it into more than a
  read" — never *mint* it. The claim must be unrepresentable for this principal, not
  merely unused, because the read path for `owner` bypasses every gate and is consumed in
  more than one place.
- **The app authorizes; the viewer verifies** (ADR-0056's keystone). Whatever the viewer
  origin does with this token, it must not become an authorization decision made on the
  credential-free origin.
- **The grantee is not gaining access.** They can already open the editor on this report
  and read — and rewrite — every byte of it. A read capability is strictly less than what
  `canWrite` already holds. This is what makes the widening arguable at all; it is not a
  reason to be careless about its shape.
- **`GET /<slug>` stays byte-for-byte unchanged** (ADR-0038). Nothing here touches what the
  canonical route serves, only whether this requester is admitted to it.
- **A capability a grantee holds must not outlive the grant by much.** Ownership cannot be
  revoked; a write grant can, and routinely is. The owner token's accepted 24h
  un-revocability (ADR-0056) does not transfer to this principal for free.

## Considered options

1. **Mint an `owner: true` `Access token` for a grantee too.** Rejected outright — review
   #146. It is a lie in the claim and a bypass of every share gate.
2. **Widen the owner-view capability cookie (`arp_view`) to `Path=/<slug>`** so the frame
   carries it. Rejected, and it is the most dangerous of the options because it looks like
   the smallest: `/<slug>` is the request the **sandboxed iframe** makes, so this hands an
   authenticated write capability to the untrusted report's own navigation. ADR-0089 §4a
   calls this "the whole reason the design is safe"; this option is its exact violation.
3. **Have the owner view server-side fetch the report bytes and inline them**, bypassing
   the frame's own gate. Rejected — it abandons the "the same bytes, the same response,
   the same headers a share-link visitor gets" property that is the point of ADR-0089, and
   it would put untrusted report bytes inside the chrome document's own origin.
4. **Run a live `canWrite` check on the view origin** and serve the frame off that.
   Rejected — see §5.
5. **A distinct, scope-discriminated read token, minted by the app for canWrite
   non-owners, verified by the viewer, redeemed into the existing `arp_unlock` cookie.**
   Chosen.

## Decision outcome

### 1. The Grantee read token — the claim shape, and why it cannot be confused

A new capability in the same HMAC-compact codec family as the `Access token` and the
`Edit token` (`packages/domain/src/grantee-read-token.ts`, over `claims-codec.ts`):

```ts
export interface GranteeReadClaims extends TokenClaims {
  readonly slug: string;   // SINGLE-REPORT binding
  readonly exp: number;    // epoch seconds — short-lived, see §4
  readonly sub: string;    // the acting user (UserId), required + non-empty
  readonly scope: "granteeRead"; // SINGLE-PURPOSE discriminant
}
```

Note first what is **absent**: there is no `owner` field, and no `mode` field. The claim
this record exists to avoid is not merely unset — it is **unrepresentable in this shape**.

The discriminant is the security boundary, exactly as `scope: "edit"` is for the Edit
token (ADR-0063 §3). `parseGranteeReadClaims` requires `scope === "granteeRead"` exactly
and a non-empty `sub`, so an `AccessClaims` payload — including an `owner: true` one,
signed with the same shared secret — has neither field and can never narrow into it.

**The reverse direction is closed too, and that is new.** Until now `parseAccessClaims`
accepted any payload carrying `slug` + `exp` and silently dropped unknown keys, so an
`Edit token`'s payload *would* narrow into `AccessClaims` as `{slug, exp}`. That was never
an escalation — a claims object with no `owner` and no `mode` fails the mode check in
`resolveAccessDecision` and yields `unlock` — but it was true by *effect* rather than by
construction, and this record adds a second token to the family that would inherit the
same looseness. So **`parseAccessClaims` now rejects any payload carrying a `scope` key**.
No mint site has ever set `scope` on an `Access token`, so this is behaviour-preserving
for every token that exists, and it makes the family's rule structural: *a token carrying
a `scope` is never an `Access token`.*

`sub` is carried for the same reasons the Edit token carries it — it binds the capability
to a principal for audit, and its required-and-non-empty check is part of what makes the
shape non-narrowable. The view origin does not resolve it against anything (§5).

### 2. Minted at `/open`, in the same branch that decides `oa` — never a second mint

`GET {app}/reports/{slug}/open` is **the app's one edit-token mint** (ADR-0059 §4) and it
has already run `loadWritableReport` and already knows whether the actor is the owner. A
second mint seam would be a second place for the owner/non-owner split to be re-decided,
and re-deciding that split is the failure this whole record is about. So the token is
minted there, by the **same `isOwner` branch** that already decides `oa`:

| Principal | Appended to the redirect |
| --- | --- |
| owner (`report.ownerId === actor.userId`) | `&oa=<Access token, owner: true>` — unchanged |
| canWrite non-owner (write grant, personal or org) | `&gr=<Grantee read token>` |

The two are **mutually exclusive by construction** — one ternary over one boolean, never
two independent conditions that could both be true. That structure, not a downstream
check, is the answer to "no path mints `owner: true` for a non-owner", and a test pins
both halves: an owner's redirect carries `oa=` and no `gr=`; a grantee's carries `gr=` and
no `oa=`, and the `gr` token does not parse as an `Access token` at all.

The audit line gains `granteeReadMinted` beside the existing `ownerFallbackMinted`, so the
two mints are distinguishable in incident response rather than inferable from the absence
of the other.

### 3. Verified — never minted — on the view origin, and redeemed into `arp_unlock`

`acceptGranteeRead` in the gate mirrors `acceptOwnerFallback` arm for arm: a 1 KiB length
cap checked **before** the HMAC, fails closed on an unset secret, slug-bound, unexpired.
The view origin verifies a signature and nothing else, so ADR-0056's keystone holds
unchanged.

**It redeems into `arp_unlock` at `Path=/<slug>` — the existing cookie, not a new one.**
That is the cookie the framed navigation carries, which is the entire objective; and
`Path=/<slug>` is a path ADR-0089 §4a guards carefully, so putting a *second* cookie there
would double the surface that guard has to cover for no gain. The value in `arp_unlock` is
already "a slug-bound token the viewer verifies per request"; a Grantee read token is
exactly that.

The hand-off mirrors the owner's triple:

| Shape | Cookies set | Then |
| --- | --- | --- |
| `GET /<slug>/view?et=…&oa=…` (owner) | `arp_view`, `arp_view_oa` (`Path=/<slug>/view`), `arp_unlock` (`Path=/<slug>`) | 303 to the clean URL — unchanged |
| `GET /<slug>/view?et=…&gr=…` (grantee) | `arp_view`, `arp_view_gr` (`Path=/<slug>/view`), `arp_unlock` (`Path=/<slug>`) | 303 to the clean URL |

`arp_view_gr` exists for the same reason `arp_view_oa` does: the 303 strips the query, so
without a cookie copy the capability would die at the first hop — the 2026-08-06 owner
lockout, one principal over. It is percent-encoded through the same single builder, and
scoped to `/<slug>/view` so it is **never sent on the framed `GET /<slug>`** and never on
`/<slug>/edit` (which must keep funnelling to the app's live `canWrite` re-check, ADR-0089
§4b).

And, exactly as ADR-0089 §3 does for `oa`, **any `serve` holding a verified `gr` re-issues
`arp_unlock`** rather than relying on the 303 having set it. One rule over every arm, for
the reason that record gives: an arm-specific cookie is what rots when the matrix grows a
row.

`resolveAccessDecision` gains **one branch**, placed before the existing `Access token`
logic and leaving it untouched: a verified Grantee read token serves **mode-independently**
(a query-borne one becomes a `grant`, setting the cookie; a cookie-borne one serves). It
sets no `owner` flag, consults no mode, and is reached only by a token that could not have
been minted for anyone but a canWrite non-owner.

### 4. Bounded by the Edit token's own TTL — 15 minutes, not 24 hours

`GRANTEE_READ_TTL_SECONDS = EDIT_TTL_SECONDS` (900s).

The asymmetry with the owner's `OWNER_TTL_SECONDS` (24h) **is the decision, not an
oversight**: an owner cannot be de-owned, a grantee can be de-granted, and ADR-0056's
accepted "un-revocable for its TTL" trade-off was accepted *about owners*. It does not
transfer.

Tying it to the Edit token's life rather than inventing a third number means a grantee's
whole session — `arp_view`, `arp_view_gr` and the `arp_unlock` derived from it — expires
**together**, and the recovery is the funnel back through `/open`, the app's one mint,
which re-runs `loadWritableReport` **live**. So revocation latency for a grantee is
≤15 minutes, which is the same bound ADR-0063 Phase 5-D already accepts for the write
capability itself — and it is bought the same way ADR-0089 §4b buys it for the Edit
action: *"the extra hop is not a cost we are tolerating; it is the revocation property,
bought back."*

ADR-0089 §4c rejected capping the *owner's* `arp_unlock` at 15 minutes because the frame
would "start bouncing to the unlock wall mid-session, which is a confusing failure in the
one place the user cannot see the URL". That objection is weaker here and is consciously
accepted: the framed report is a completed document load, so it re-navigates only on a
reload or an in-report link (a deck's slide changes are hash changes, not navigations);
and when the frame does bounce, the chrome around it has also just expired, so the next
owner-view navigation funnels through `/open` and repairs the whole session at once,
rather than leaving a live chrome wrapped around a dead frame.

**`OWNER_TTL_SECONDS` is unchanged.** Nothing about the owner path moves in this record.

### 5. Rejected: a live `canWrite` check on the view origin

This was the strongest alternative and it is worth recording why it lost, because the
capability to do it genuinely exists: `apps/view` holds a live Neon/Drizzle `DbContext`,
`resolveAccessDecision` **already** performs a live per-request grant check for
`allowlist` (ADR-0056 revocation-C), the owner view already reads `orgWriteGrants` for its
share badge (ADR-0078 §3), and a verified token's `sub` is a real internal `UserId`. So
`hasWriteGrant(reportId, { userId: sub }, …)` on the view origin would work, and would make
revocation **immediate** rather than ≤15 minutes.

Rejected on three grounds:

- **It makes the viewer authorize.** ADR-0056 §1's keystone is that the app authorizes and
  the viewer only verifies a signature. The allowlist precedent is narrower than it looks:
  that check is a *liveness* probe on a grant the app already authorized, keyed by an email
  the token itself carries. Re-deriving `canWrite` — three legs, one of them org-scoped —
  on the credential-free origin is a second implementation of the authorization rule, on
  the origin least equipped to own it.
- **It puts the identity mirror on the untrusted-content origin.** The email-match leg of
  `hasWriteGrant` needs `IdentityStore.findEmailByUserId` (ADR-0060 §2). Reading user
  emails on `view.<domain>` widens ADR-002's blast radius by a category — from "report
  rows" to "who our users are" — to shorten a revocation window that a 15-minute TTL
  already bounds.
- **It bills the hot path.** The check would land on `GET /<slug>`, the platform's most
  requested route, which today answers a public report with one lookup.

**This is the named lever.** If grant-revocation latency ever needs to be under 15 minutes,
the ordered moves are: shorten `GRANTEE_READ_TTL_SECONDS` first (it costs only extra
funnel hops), and only then add the live check — scoped to requests actually carrying a
Grantee read token, so the public path keeps its current cost.

### 6. `password` mode admits it, and so does every other mode

The ticket asked whether `password` should be the exception — whether the right answer for
that mode is that the grantee still types the password.

It should not. **Mode-independence is the capability, not a convenience.** A write-grantee
can open `/<slug>/edit` and read every byte of the report there, and save new ones over
it. Requiring them to clear the report's *reader* gate to see those same bytes rendered
under chrome protects nothing — it is the "chrome around a wall" defect in a politer
costume, and it would make the owner view the one surface where `canWrite` does not imply
read. The gate a share mode expresses is about *readers the owner has not chosen*; a
write-grantee is a collaborator the owner chose explicitly.

The same reasoning covers `private` (owner-only *by default*, and the owner overrode that
by granting write), `allowlist` and `org`.

### 7. What the Grantee read token deliberately does NOT do

Scope discipline, recorded so a later reader does not "fix" these as omissions:

- **It is not a fallback capability.** Unlike `oa`, it never stands in for the owner view's
  own capability: it does not produce a `capability` value, does not participate in the
  rejection-vs-absence funnel routing (ADR-0063 Phase 5-G), and cannot cause a `serve`. A
  grantee whose `arp_view` capability is absent or rejected **funnels to `/open`**, which
  re-checks `canWrite` live — strictly better than serving them chrome off a stale cookie.
- **It does not steer a degrade.** `degradeTo` and the `ownerFallback` boolean that selects
  the degrade log event stay exactly as ADR-0089 left them, so `/edit`'s incident queries
  and the owner view's own are unchanged in meaning. A grantee reaching a degrade is rare
  by construction (their denials funnel), and making `gr` a degrade target would quietly
  redefine an event name that is one week old.
- **It grants no write anywhere.** It is accepted by `resolveAccessDecision` — the read
  gate — and by nothing else. It is not a front door on the app's API (`resolveEditTokenActor`
  parses `EditClaims` and rejects it), and it cannot narrow into an `Access token` (§1).

## Consequences

- The PRD #356 story 24 case works: a `canWrite` collaborator opening a report they can
  edit gets the owner view with the report **rendered** in the frame, in every share mode.
- The token family grows to three (`Access`, `Edit`, `Grantee read`) over one secret and
  one wire format. The `scope` discriminant is what keeps them apart, and as of this record
  that separation is structural in **both** directions rather than one. The failure mode to
  watch: a fourth token added without a `scope`, which would silently become narrowable
  into `AccessClaims` again.
- The viewer origin now verifies two claim shapes on the public read path instead of one.
  It still authorizes nothing.
- A grantee's read capability is bounded at 15 minutes and repairs itself through the app's
  one mint. The cost is extra `/open` round-trips on long reading sessions; the benefit is
  that a revoked grant stops working without anything on the view origin knowing what a
  grant is.
- `parseAccessClaims` is strictly stricter. If any unrecorded mint site ever did set
  `scope` on an `Access token`, its tokens would stop verifying — a grep found none, and a
  cross-parse test pins the rule from both sides.

## More information

- Implementation: `packages/domain/src/grantee-read-token.ts` (the codec) and the
  `scope`-rejection in `packages/domain/src/access-token.ts`;
  `packages/application/src/use-cases/resolve-access.ts` (the one new branch);
  `apps/app/app/server/open-report.server.ts` (the mint, in the existing `isOwner`
  ternary); `apps/view/app/server/gate.server.ts` (`acceptGranteeRead`, the
  `Surface.granteeCookie`, the hand-off's third cookie and the serve arm's re-issue).
  `packages/headers` is untouched, and so is `GET /<slug>`'s response.
- Glossary: **Grantee read token** is added to `docs/domain-glossary.md` in the same change.
- ADR-0089 §8 is rewritten in the same change to point at this record rather than describe
  an open limitation.
- Closes #376; PRD #356. Lands with #363, which is the change that makes the gap reachable.
