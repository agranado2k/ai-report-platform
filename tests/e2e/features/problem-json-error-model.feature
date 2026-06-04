@phase-1
Feature: RFC 9457 problem+json error model
  As an API or MCP client
  I want errors as standard, machine-branchable documents
  So that I can handle failures programmatically (ADR-0040)

  Scenario: Errors use the problem+json media type
    When any API request fails
    Then the response content type is "application/problem+json"
    And the body has the RFC 9457 members "type", "title", "status", and a stable "code"

  Scenario Outline: AppError kinds map to fixed status codes
    Given a request that triggers a "<kind>" error
    When the HTTP adapter renders the response
    Then the status is "<status>" and the "code" is "<code>"

    Examples:
      | kind                  | status | code                    |
      | Unauthenticated       | 401    | unauthenticated         |
      | NotAllowed            | 403    | forbidden               |
      | NotFound              | 404    | not_found               |
      | UnsupportedMediaType  | 415    | unsupported_media_type  |
      | PayloadTooLarge       | 413    | payload_too_large       |
      | ValidationError       | 422    | validation_error        |
      | IdempotencyInFlight   | 409    | idempotency_in_flight   |
      | PlanLimitExceeded     | 402    | plan_limit_exceeded     |
      | RateLimited           | 429    | rate_limited            |

  Scenario: The mapping lives only in the HTTP adapter
    Then the domain returns a Result with an AppError and never an HTTP status
