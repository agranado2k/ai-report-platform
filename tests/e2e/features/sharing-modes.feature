@phase-2 @wip
Feature: Sharing modes gate access
  As a report owner
  I want to choose how a report is shared
  So that I can restrict access beyond the default public link

  # WIP: only public mode ships in Phase 1; richer modes land in Phase 2.
  # ADR-0059 §3: reading a report's share config (GET /reports/{slug}/acl, the
  # getAcl use case) is OWNER-only — a same-org colleague gets 403, and the
  # report resource omits its acl block for non-owners. Not exercisable e2e
  # until the ADR-0061 two-member-org fixture exists; pinned at unit level
  # (get-acl.test.ts, write-response.test.ts).
  Scenario Outline: Each ACL mode gates access correctly
    Given a report with ACL mode "<mode>"
    When a requester who "<eligibility>" the rule requests it
    Then access is "<outcome>"

    Examples:
      | mode      | eligibility   | outcome  |
      | public    | holds the link| granted  |
      | password  | knows         | granted  |
      | password  | does not know | denied   |
      | org       | belongs to    | granted  |
      | allowlist | is not on     | denied   |
