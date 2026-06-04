@phase-1 @security
Feature: Reject SVG uploads
  As the platform operator
  I want SVG content rejected at upload
  So that scriptable vector images cannot smuggle active content (ADR-0015)

  Background:
    Given an API key with the "reports:write" scope

  Scenario: An SVG file by extension is rejected
    When I POST a "diagram.svg" file to "/api/v1/reports"
    Then the response status is 415
    And the problem+json "code" is "unsupported_media_type"

  Scenario: An SVG disguised with a different extension is rejected by content sniff
    Given a file named "image.png" whose sniffed content type is "image/svg+xml"
    When I POST the file to "/api/v1/reports"
    Then the response status is 415
    And the decision is made by content sniffing, never the Content-Type header
