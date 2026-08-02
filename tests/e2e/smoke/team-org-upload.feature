@smoke @auth
Feature: Team-org JIT join-or-create smoke (ADR-0068, ADR-0074)
  As the second identity at a corporate email domain
  I want my first authenticated request to join (or create) my domain's team org
  So that domain-keyed single-org membership actually provisions in production, not just in unit tests

  # Runs under the same @auth gate as auth-upload.feature (needs
  # E2E_CLERK_SECRET_KEY; see playwright.config.ts). Uses the ADR-0068 §6 second
  # fixture (silver+clerk_test@agranado.com — tests/e2e/README.md), whose domain
  # is deliberately NOT on the public-provider list, so this exercises the
  # `team`-org branch of provisionIdentity. The upload exercises the write
  # path's JIT provisioning; the read path lazily provisions too since the
  # ADR-0048 amendment (2026-08-01), covered by the third identity below.
  Scenario: The second identity's first authenticated upload provisions its team org
    Given I am signed in as the second (team-org) Clerk test user
    When I upload an HTML report file with my second session to "/api/v1/reports"
    Then the second session's upload response status is 201
    And the second session's upload returns a slug and a canonical view_url

  # ADR-0074 — the assertion the old smoke deliberately dodged ("either outcome
  # is a pass" is what let the dead slug-keyed lookup ship): two identities at
  # the SAME corporate domain must resolve to ONE shared org. Both identities
  # are RUN-SCOPED (fresh `<prefix>-<runId>+clerk_test@agranado.com` users,
  # created programmatically — see tests/e2e/README.md): the PR #222 round-3
  # lesson is that a REUSED fixture can carry a poisoned mirror from an earlier
  # run in the persistent, prod-forked preview DB branch, which the
  # sticky-after-mirror policy then CORRECTLY honors — masking the canonical
  # chain this scenario exists to prove. Each identity also carries a
  # self-created anchorless DECOY org, replicating the duplicate that
  # force_organization_selection produces in prod (and, on the dev instance,
  # the only way a fresh user's backend-minted session comes out `active`
  # instead of `pending`/401 — Clerk auto-activates the sole membership, so the
  # session actively CARRIES the decoy). Both uploads must land in the
  # CANONICAL anchored domain org despite the decoys; the final listing is read
  # with a session re-minted with that canonical org ACTIVE — like a browser
  # session after the forced task's org selection. Fixtures are best-effort
  # deleted after the scenario (@run-scoped cleanup hook).
  # The THIRD identity is the ADR-0048 amendment's proof (provision-on-read,
  # 2026-08-01): it NEVER uploads — its first authenticated request is the
  # bare session GET /api/v1/reports. Pre-amendment that read resolved to a
  # null actor (unmirrored → 401/empty); now the read door lazily provisions
  # through the same canonical chain (its session actively carries its DECOY
  # org, which the mirror-miss branch must ignore).
  # VISIBILITY (ADR-0075, amends the original #228 assertion BY DESIGN): the
  # two uploads are default-PRIVATE, so a colleague no longer sees them just
  # by sharing the org. The first identity org-shares ITS report via the ACL
  # API; the third (never-written, owns nothing) must then list EXACTLY the
  # org-shared report and NOT the second identity's still-private one — the
  # sharper form of the same shared-org proof: the org-shared report could
  # only appear if all three identities resolved to ONE org row, and the
  # private one's absence proves existence stays private inside that org.
  # The second identity still lists both: its own by ownership, the first's
  # by the org share.
  @run-scoped
  Scenario: Two same-domain identities share one team org
    Given a first run-scoped team-domain identity is signed in
    And a second run-scoped team-domain identity is signed in
    And a third run-scoped team-domain identity is signed in and never uploads
    When the first run-scoped identity uploads an HTML report file to "/api/v1/reports"
    And the second run-scoped identity uploads its own HTML report file to "/api/v1/reports"
    And the first run-scoped identity shares its report org-wide via the ACL API
    Then the second run-scoped identity's report listing includes both run-scoped uploads
    And the third run-scoped identity's first-ever session read lists exactly the org-shared upload
