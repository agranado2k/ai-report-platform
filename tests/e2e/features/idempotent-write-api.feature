@phase-1
Feature: Idempotent write API
  As an API or MCP client that retries on network failure
  I want writes to be idempotent
  So that a retry never creates a duplicate report or version (ADR-0039)

  Background:
    Given an API key with the "reports:write" scope

  Scenario: Replaying the same Idempotency-Key returns the stored response
    Given I uploaded a report with "Idempotency-Key" of "key-123"
    When I POST the same request again with "Idempotency-Key" of "key-123"
    Then the original response is replayed without creating a new version

  Scenario: Reusing a key with a different body is a client error
    Given I uploaded a report with "Idempotency-Key" of "key-123"
    When I POST a different body with "Idempotency-Key" of "key-123"
    Then the response status is 422
    And the problem+json "code" is "idempotency_key_reuse"

  Scenario: A concurrent in-flight retry is rejected
    Given a request with "Idempotency-Key" of "key-123" is still processing
    When I POST a retry with "Idempotency-Key" of "key-123"
    Then the response status is 409
    And the problem+json "code" is "idempotency_in_flight"

  Scenario: With no header, identical content and target dedup via a derived key
    When I POST identical content to the same target twice with no "Idempotency-Key"
    Then the second request replays the first response
    And no duplicate report is created

  Scenario: A deliberate republish uses a fresh explicit key
    Given identical byte content was already uploaded
    When I POST it again with a fresh "Idempotency-Key"
    Then a new ReportVersion is created
