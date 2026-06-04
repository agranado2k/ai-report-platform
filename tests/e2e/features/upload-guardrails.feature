@phase-1
Feature: Upload pre-check guardrails
  As the platform operator
  I want malicious or oversized bundles rejected before any storage write
  So that hosting untrusted content stays safe and bounded

  Background:
    Given an API key with the "reports:write" scope

  Scenario: A path-traversal (zip-slip) entry is rejected
    Given a zip bundle containing an entry path "../../etc/passwd"
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 422
    And nothing is written to object storage

  Scenario: A decompression bomb is rejected
    Given a zip bundle whose decompression ratio exceeds the block threshold of 1000 to 1
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 413
    And the problem+json "code" is "payload_too_large"

  Scenario: A nested archive is rejected
    Given a zip bundle that contains another archive
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 422

  Scenario Outline: Hard caps are enforced
    Given a bundle that exceeds the "<cap>" limit
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 413

    Examples:
      | cap                  |
      | per-file 25 MiB      |
      | file count 20000     |
      | uncompressed 250 MB  |

  Scenario: An ambiguous archive with no resolvable entry document is rejected
    Given a zip bundle with two top-level directories and no root index.html
    When I POST the bundle to "/api/v1/reports"
    Then the response status is 422
    And the entry document is never guessed
