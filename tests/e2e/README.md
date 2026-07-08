# E2E test fixtures

This suite runs against real infrastructure (ADR-019 — no mocks for external
services in e2e). Two Clerk identities are hand-provisioned on the **dev/staging**
Clerk instance (`pk_test`/`sk_test`, ADR-0048) so scenarios can authenticate as a
real user without a browser sign-in flow (`tests/e2e/support/clerk-session.ts`
mints a session token via the Clerk backend REST API). This is the one accepted
ADR-017 exception in this repo — a clicked fixture, not code — so both
identities are documented here for reconstructability (per ADR-0068 §6).

## Fixture 1 — the primary test user

| | |
|---|---|
| Purpose | The `@auth @smoke` scenario (`tests/e2e/smoke/auth-upload.feature`) |
| Email | `E2E_TEST_USER_EMAIL` (a GitHub repo **variable**, not a secret — the address itself isn't sensitive) |
| Org (ADR-0068 §1) | Whatever its email domain resolves to. If it's a public-provider address (gmail.com, outlook.com, …), it lands in a `personal` org; otherwise it's the first (and likely only) member of that domain's `team` org. |
| Reconstruction | Sign up the address once on the dev Clerk instance (any method — email code, password, etc.) so it exists as a Clerk user. Set the GitHub Actions repo variable `E2E_TEST_USER_EMAIL` to that address. `E2E_CLERK_SECRET_KEY` (repo **secret**, `CLERK_SECRET_KEY_STAGING`) is already wired in `.github/workflows/e2e.yml`. |

## Fixture 2 — the second identity (ADR-0068 §6, team-org colleague)

| | |
|---|---|
| Purpose | Any scenario needing a SECOND real identity acting against the same report/org — the `@phase-2 @wip` scenarios in `tests/e2e/features/sharing-modes.feature` (owner-only ACL read, org-mode unlock) and `tests/e2e/features/report-write-grants.feature` (the write-grant lifecycle) all need this and are blocked on more than just the fixture — see "Current status" below. |
| Email | `silver+clerk_test@agranado.com` — hardcoded as `SECOND_FIXTURE_EMAIL` in `tests/e2e/support/clerk-session.ts` (not a secret; a stable, documented fixture address, same rationale as fixture 1). |
| Why `+clerk_test`? | Clerk treats any address containing `+clerk_test` as **test mode**: it always verifies with the fixed code **`424242`**, no real inbox needed, no email actually sent. This only works on Clerk **test** instances (dev/staging here), never on `pk_live`. |
| Org (ADR-0068 §1) | Domain `agranado.com` is **not** on the public-provider list (`packages/domain/src/org-key.ts`), so this address resolves to a **`team`** org keyed by `agranado.com` — deliberately chosen so it exercises the team-org / multi-member paths, not another personal org. |
| Reconstruction | On the dev Clerk instance dashboard: create a user with email `silver+clerk_test@agranado.com` (any sign-up method; the `+clerk_test` suffix makes Clerk accept verification code `424242` for it). No further manual step is needed — the first authenticated request through the app JIT-provisions its `team` org (ADR-0068 §3); a second real user at `@agranado.com` (or the primary fixture, if its domain happens to also be `agranado.com`) would join the SAME org. |
| Minting a session for it | `mintSecondTestSession()` in `tests/e2e/support/clerk-session.ts` — needs only `E2E_CLERK_SECRET_KEY` (already wired for fixture 1; same dev instance). |

If this fixture is ever lost (Clerk instance reset, account deleted — cf. the
ADR-0049 instance-hygiene incident) — recreate it exactly as above and treat any
drift as a **fixture bug**, not a test bug (ADR-0068 §6's explicit call).

> **One-time cleanup after PR #158's review wave:** the team-org slug scheme
> gained a domain-hash suffix (review #158 C-1), so any `agranado-com` Clerk
> org JIT-created on the dev instance under the OLD scheme is now stale —
> lookups use the new slug and the old org would leave the fixture user with
> a divergent oldest-membership. Delete the old `agranado-com` org in the dev
> Clerk dashboard; the next fixture sign-in re-provisions under the new slug
> (with the `publicMetadata.domain` anchor the join guard requires).

## Current status — what's wired vs what's still blocked

Fixture 2 (this PR) makes it POSSIBLE to mint a session for a second identity. It
does **not**, by itself, make `sharing-modes.feature` / `report-write-grants.feature`
executable, because of a pre-existing gap that predates this PR:

- Neither feature file has ANY step definitions (unlike `tests/e2e/smoke/*.steps.ts`).
- `playwright.config.ts`'s `testDir` glob only includes `tests/e2e/smoke/**/*.feature`
  — the 29 product `.feature` files under `tests/e2e/features/` are not even
  collected by playwright-bdd yet (a long-standing TODO predating this PR — see
  the comment at the top of `playwright.config.ts` and `.github/workflows/e2e.yml`).

Authoring a full BDD step-definition layer for these two features (API client
helpers, two-session fixtures, org/ACL scenario wiring) is a distinct, sizeable
piece of work — comparable in scope to standing up the product-feature e2e layer
itself — and is out of scope for the ADR-0068 team-orgs PR. Both scenario files
stay `@wip` with this precise blocker noted inline; un-`@wip`-ing them, widening
`playwright.config.ts`'s `testDir`, and writing their step definitions is tracked
as separate follow-up work.
