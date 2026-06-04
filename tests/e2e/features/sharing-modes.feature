@phase-2 @wip
Feature: Sharing modes gate access
  As a report owner
  I want to choose how a report is shared
  So that I can restrict access beyond the default public link

  # WIP: only public mode ships in Phase 1; richer modes land in Phase 2.
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
