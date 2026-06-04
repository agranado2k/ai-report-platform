@phase-4 @wip
Feature: Enforce MFA for admins
  As the platform operator
  I want admins to enroll in multi-factor authentication
  So that privileged accounts are protected

  # WIP: MFA enforcement lands in Phase 4.
  Scenario: An admin without MFA is forced to enroll
    Given an admin account without MFA
    When the admin signs in
    Then they are required to enroll in MFA before continuing
