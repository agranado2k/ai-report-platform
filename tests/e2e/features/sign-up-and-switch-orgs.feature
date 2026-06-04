@phase-1
Feature: Sign up and switch organizations
  As a new user
  I want to sign up and work within an organization
  So that my reports and folders are tenant-scoped (ADR-0005)

  Scenario: A new user gets a personal organization by default
    When I sign up
    Then I belong to a personal organization
    And that organization has a root folder

  Scenario: Data is scoped to the active organization
    Given I belong to two organizations
    When I switch to a different active organization
    Then I only see reports and folders owned by that organization

  Scenario: Identity is mirrored from the auth provider
    When my account is created
    Then a "UserCreated" event records the mirrored UserId
