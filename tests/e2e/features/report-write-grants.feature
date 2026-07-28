@phase-2 @wip
Feature: Per-report write grants
  As a report owner
  I want to let a specific person write (rename / re-upload / move) one of my reports
  So that someone outside my org can help maintain it, without giving them ownership or view access

  # WIP: exercising a grantee's actual rename/re-upload/move requires a SECOND
  # real identity acting against the same report — deferred to the ADR-0061
  # two-member/two-identity fixture (same deferral noted in sharing-modes.feature
  # for the owner-only ACL read scenario). Until then, the full lifecycle is
  # pinned at the unit + port-contract level:
  #   - grant-write.test.ts / revoke-write.test.ts / list-write-grants.test.ts
  #     (owner-only + acl:write scope; email normalization; opportunistic
  #     grantee_user_id resolution; idempotent revoke)
  #   - load-owned.test.ts (canWrite = isOwner OR hasWriteGrant; the
  #     loadReadableReport grantee metadata carve-out)
  #   - write-grant-store.contract.test.ts, run against BOTH the in-memory fake
  #     and DrizzleWriteGrantStore-on-pglite (findFor's userId-or-email match)
  #
  # ADR-0068 §6 update: the second identity now EXISTS (silver+clerk_test@
  # agranado.com, a team-org member — see tests/e2e/README.md) and
  # tests/e2e/support/clerk-session.ts can mint it a session
  # (mintSecondTestSession). Still @wip because of a DIFFERENT, pre-existing
  # blocker: this feature file has no step definitions at all, and
  # playwright.config.ts's testDir doesn't even collect tests/e2e/features/**
  # yet (only tests/e2e/smoke/**) — see tests/e2e/README.md "Current status".
  # The fixture is a prerequisite, not the whole gap.
  #   - write-response.test.ts (the write_grant wire shape)

  Background:
    Given an authenticated acting user who owns a report
    And an API key with the "acl:write" scope

  Scenario: The owner grants write access to someone by their email address
    When I grant write access to the grantee's email address
    Then the response status is 201
    And the body is a "write_grant" resource for that email address

  Scenario: The owner lists everyone with write access
    Given a write grant already exists for the grantee
    When I list the report's write grants
    Then the response status is 200
    And the list contains the grantee's write_grant

  Scenario: The owner revokes a write grant
    Given a write grant already exists for the grantee
    When I revoke the grantee's write access
    Then the response status is 204
    And the grantee no longer has write access to the report

  Scenario: A non-owner (same org) cannot grant, list, or revoke write access
    Given the acting user does NOT own the report
    When I try to grant write access to someone
    Then the response status is 403

  Scenario: An API key without the acl:write scope cannot manage write grants
    Given an API key with only the "reports:write" scope
    When I try to grant write access to someone
    Then the response status is 403

  # Deferred to the ADR-0061 two-identity fixture: a real second user acting AS
  # the grantee.
  Scenario: A write grantee can rename, re-upload, and move the report
    Given a write grant exists for the grantee
    When the grantee renames the report
    Then the response status is 200
    When the grantee re-uploads a new version under the same slug
    Then the response status is 201
    When the grantee moves the report to a folder in the report's org
    Then the response status is 200

  Scenario: A write grantee cannot delete, set_acl, or manage grants
    Given a write grant exists for the grantee
    When the grantee tries to delete the report
    Then the response status is 403
    When the grantee tries to change the report's acl
    Then the response status is 403
    When the grantee tries to grant write access to someone else
    Then the response status is 403

  Scenario: A write grantee (outside the report's org) can still read the report's metadata
    Given a write grant exists for the grantee
    And the grantee is NOT a member of the report's org
    When the grantee fetches the report
    Then the response status is 200
    And the response omits the "acl" block (share config stays owner-only, ADR-0059 §3)

  Scenario: Revoking a grant denies the next request
    Given a write grant exists for the grantee
    And the owner revokes it
    When the grantee tries to rename the report
    Then the response status is 403
