@phase-3 @wip
Feature: Upload a report via MCP
  As an LLM using the MCP server
  I want to upload a report through an MCP tool
  So that an agent can publish without crafting raw HTTP (ADR-0003)

  # WIP: MCP server is a thin wrapper over the HTTP API; lands in Phase 3.
  Scenario: An MCP upload lands in the correct org and folder
    Given an MCP client authenticated for a user
    When the client calls the upload tool with a report bundle
    Then the report is created in the user's active organization and target folder
    And the tool returns the permanent view URL
