@phase-2 @wip
Feature: Review a report's version history and compare two versions
  As a report owner
  I want to see my report's version history in the dashboard and compare two
  versions side by side
  So that I can discover past uploads/edits and review what changed, without
  guessing ?v=N (ADR-0065)

  Background:
    Given a user signed in to the dashboard on the app origin
    And a report at slug "abc1234567" owned by that user

  Scenario: The versions page lists every version with its metadata and actions
    Given the report has 2 versions: v1 (origin "upload") and v2 (origin "editor")
    When I open "/reports/abc1234567/versions"
    Then I see both versions listed newest-first
    And each row shows its version number, uploaded-at time, scan status, and origin badge
    And v2's row offers a "Compare with previous" link to v1
    And v1's row has no "Compare with previous" link (it is the first version)
    And each row's "View" link points at "view.<domain>/abc1234567?v=<version_no>"

  Scenario: Comparing two editor-produced versions shows the structural word-level diff
    Given the report has 2 versions, both saved via the in-app editor (both carry a "_source.json" sidecar)
    And the second version changed one word in a paragraph
    When I open "/reports/abc1234567/diff?from=1&to=2"
    Then the page renders the report's body only, not its presentation shell
    And the changed word is marked with an insertion class
    And the replaced word is shown as a deletion-style annotation
    And no "structural diff unavailable" label is shown

  Scenario: Comparing an uploaded-only version against another falls back to a labeled raw comparison
    Given the report has 2 versions and the older one has no "_source.json" sidecar
    When I open "/reports/abc1234567/diff?from=1&to=2"
    Then the page shows the label "structural diff unavailable — raw comparison"
    And the changed block is still visually marked as changed

  Scenario: A non-owner cannot view another user's report's version history or diff
    Given a report at slug "xyz9876543" owned by a different user
    When that different user's session opens "/reports/xyz9876543/versions"
    Then they are redirected away, never seeing the report's version list
    When that different user's session opens "/reports/xyz9876543/diff?from=1&to=2"
    Then they are redirected away, never seeing the diff
