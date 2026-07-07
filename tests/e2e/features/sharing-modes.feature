@phase-2 @wip
Feature: Sharing modes gate access
  As a report owner
  I want to choose how a report is shared
  So that I can restrict access beyond the default public link

  # WIP: only public mode ships in Phase 1; richer modes land in Phase 2.
  # ADR-0059 §3: reading a report's share config (GET /reports/{slug}/acl, the
  # getAcl use case) is OWNER-only — a same-org colleague gets 403, and the
  # report resource omits its acl block for non-owners. Not exercisable e2e
  # until the ADR-0061 two-member-org fixture exists; pinned at unit level
  # (get-acl.test.ts, write-response.test.ts).
  Scenario Outline: Each ACL mode gates access correctly
    Given a report with ACL mode "<mode>"
    When a requester who "<eligibility>" the rule requests it
    Then access is "<outcome>"

    Examples:
      | mode      | eligibility   | outcome  |
      | public    | holds the link| granted  |
      | password  | knows         | granted  |
      | password  | does not know | denied   |
      | org       | belongs to    | granted  |
      | allowlist | is not on     | denied   |

  # ADR-0056 P2 / G2 (issue #139): the `org` unlock branch, minimal e2e coverage.
  # A same-org session serves (the /unlock/{slug} redirect handshake mints a
  # mode-bound access token and redirects to the viewer); an anonymous requester
  # is bounced to /sign-in (preserving the return URL). A TRUE cross-org denial
  # (a second org's member hitting a report they don't belong to) needs a second
  # org member to exist — deferred to the ADR-0061 two-member-org fixture, same
  # deferral already noted above for the owner-only ACL-read scenario. The unit
  # level already pins the org-mode token logic (resolve-access.test.ts) and the
  # membership/redirect logic is a plain Remix loader, not independently
  # exercisable without that fixture.
  Scenario: A same-org session unlocks an org-mode report
    Given a report with ACL mode "org" owned by an org
    And a signed-in session belonging to that same org
    When the session visits the report's unlock page
    Then it is redirected to the viewer with a valid access token

  Scenario: An anonymous visitor is sent to sign in
    Given a report with ACL mode "org"
    When an anonymous visitor visits the report's unlock page
    Then they are redirected to sign-in with the return URL preserved
