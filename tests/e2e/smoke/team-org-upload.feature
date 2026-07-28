@smoke @auth
Feature: Team-org JIT join-or-create smoke (ADR-0068)
  As the second identity at a corporate email domain
  I want my first authenticated request to join (or create) my domain's team org
  So that domain-keyed single-org membership actually provisions in production, not just in unit tests

  # Runs under the same @auth gate as auth-upload.feature (needs
  # E2E_CLERK_SECRET_KEY; see playwright.config.ts). Uses the ADR-0068 §6 second
  # fixture (silver+clerk_test@agranado.com — tests/e2e/README.md), whose domain
  # is deliberately NOT on the public-provider list, so this exercises the
  # `team`-org branch of provisionIdentity (createTeamOrg or, if a prior run
  # already created "agranado.com"'s team org, the join/ensureMembership
  # branch — both are idempotent, so either outcome is a pass). The upload (not
  # just a GET) is required to hit the write path, since resolveActorForRead
  # deliberately never provisions.
  Scenario: The second identity's first authenticated upload provisions its team org
    Given I am signed in as the second (team-org) Clerk test user
    When I upload an HTML report file with my second session to "/api/v1/reports"
    Then the second session's upload response status is 201
    And the second session's upload returns a slug and a canonical view_url
