@phase-2 @wip
Feature: Organize reports in folders
  As a report owner
  I want to organize reports into nested folders
  So that I can structure an organization's reports

  # WIP: folder management UI/API lands in Phase 2.
  Scenario: A report belongs to exactly one folder
    Given an organization with nested folders
    When I place a report in a folder
    Then the report belongs to exactly one folder
    And it inherits that folder's grant chain
