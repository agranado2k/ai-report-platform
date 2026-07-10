@phase-2 @wip
Feature: Comment on a report
  As a report owner or collaborator with write access
  I want to leave threaded comments anchored to a location in a report
  So that I can discuss and resolve specific points without editing the content (ADR-0064)

  Background:
    Given an authenticated acting user in an organization
    And an API key with the "reports:write" scope
    And a report at slug "abc1234567" with clean version 1

  Scenario: Create a comment, reply to it, list the thread, then resolve it
    When I POST "/api/v1/reports/abc1234567/comments" with a body and an anchor pinned to version 1
    Then the response status is 201
    And the body is a "comment" resource with "parent_id" of null
    When I POST "/api/v1/reports/abc1234567/comments" with "parent_comment_id" set to the root comment's id
    Then the response status is 201
    And the body is a "comment" resource with "parent_id" equal to the root comment's id
    When I GET "/api/v1/reports/abc1234567/comments"
    Then the response status is 200
    And the body is a list envelope with "object" of "list"
    And the comments are ordered newest-created first
    And the list contains both the root comment and its reply
    When I PATCH "/api/v1/reports/abc1234567/comments/{root_comment_id}"
    Then the response status is 200
    And the body is a "comment" resource with a non-null "resolved_at"

  Scenario: Replying to a reply is rejected (single-level threading)
    Given a root comment and a reply already exist on "abc1234567"
    When I POST "/api/v1/reports/abc1234567/comments" with "parent_comment_id" set to the reply's id
    Then the response status is 422

  Scenario: An unauthenticated request is rejected
    When I GET "/api/v1/reports/abc1234567/comments" with no credential
    Then the response status is 401
    When I POST "/api/v1/reports/abc1234567/comments" with no credential
    Then the response status is 401

  Scenario: A report outside the caller's org is not-allowed
    Given a report at slug "xyz9876543" owned by a different organization
    When I GET "/api/v1/reports/xyz9876543/comments"
    Then the response status is 403
    When I POST "/api/v1/reports/xyz9876543/comments" with a body and an anchor pinned to version 1
    Then the response status is 403

  Scenario: Only the comment's author or the report's owner may resolve or delete it
    Given a root comment exists on "abc1234567", authored by the report's owner
    And a different org member with no relation to the comment
    When that member attempts to PATCH the comment to resolve it
    Then the response status is 403
    When that member attempts to DELETE the comment
    Then the response status is 403

  Scenario: Comments never surface on the public viewer
    Given a root comment exists on "abc1234567"
    When I view the public viewer page for "abc1234567"
    Then the response contains no comment data

  # RETARGETED (ADR-0063 Phase 5 dashboard-editor retirement): this scenario
  # used to describe the DASHBOARD editor's sidebar (apps/app's
  # CommentSidebar.tsx, deleted). Comment-composing UI now lives on the
  # unified in-viewer experience's Comments tab (apps/view/app/edit/components/CommentsPanel.tsx),
  # which drives the SAME add/reply/resolve API this feature already covers
  # above. Left as a TODO rather than rewritten in place: the UI-level
  # selection/highlight/thread assertions below need re-authoring against
  # CommentsPanel's actual DOM, not just a search-and-replace of "editor" ->
  # "unified experience".
  @wip
  Scenario: Add, reply, and resolve a comment from the unified in-viewer experience's Comments panel
    Given I have "abc1234567" open in the unified in-viewer editing experience
    When I select a span of text in the document and click "Comment"
    And I write a comment body and submit it
    Then the comment appears in the Comments panel as an open Thread
    And the selected text is rendered with a highlight decoration in the editor
    When I open the Thread and submit a reply
    Then the reply appears nested under the root comment
    When I click "Resolve" on the root comment
    Then the Thread shows as resolved in the Comments panel
