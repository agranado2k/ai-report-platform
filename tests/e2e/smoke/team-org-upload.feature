@smoke @auth
Feature: Team-org JIT join-or-create smoke (ADR-0068, ADR-0074)
  As the second identity at a corporate email domain
  I want my first authenticated request to join (or create) my domain's team org
  So that domain-keyed single-org membership actually provisions in production, not just in unit tests

  # Runs under the same @auth gate as auth-upload.feature (needs
  # E2E_CLERK_SECRET_KEY; see playwright.config.ts). Uses the ADR-0068 §6 second
  # fixture (silver+clerk_test@agranado.com — tests/e2e/README.md), whose domain
  # is deliberately NOT on the public-provider list, so this exercises the
  # `team`-org branch of provisionIdentity. The upload (not just a GET) is
  # required to hit the write path, since resolveActorForRead deliberately
  # never provisions.
  Scenario: The second identity's first authenticated upload provisions its team org
    Given I am signed in as the second (team-org) Clerk test user
    When I upload an HTML report file with my second session to "/api/v1/reports"
    Then the second session's upload response status is 201
    And the second session's upload returns a slug and a canonical view_url

  # ADR-0074 — the assertion the old smoke deliberately dodged ("either outcome
  # is a pass" is what let the dead slug-keyed lookup ship): two identities at
  # the SAME corporate domain must resolve to ONE shared org. The third fixture
  # (gold+clerk_test@agranado.com, find-or-created programmatically — see
  # tests/e2e/README.md) carries a self-created DECOY org, replicating the
  # duplicate that force_organization_selection produces in prod (and, on the
  # dev instance, the only way a fresh user's backend-minted session comes out
  # `active` instead of `pending`/401). It uploads its own report — landing it
  # in the CANONICAL domain org despite the decoy — then must see the second
  # fixture's report in its org listing (read via an API key it mints, whose
  # org is the canonically-resolved one): only possible if both identities
  # landed in the same org row.
  Scenario: Two same-domain identities share one team org
    Given I am signed in as the second (team-org) Clerk test user
    And I am also signed in as the third (same-domain) Clerk test user
    When I upload an HTML report file with my second session to "/api/v1/reports"
    And the third identity uploads its own HTML report file to "/api/v1/reports"
    Then the third identity's report listing includes both same-domain uploads
