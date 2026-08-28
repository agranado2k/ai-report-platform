@smoke @auth @browser
Feature: Selection toolbar formatting round-trip (real browser)
  As a signed-in report owner editing in the unified editor
  I want to bold a selection with the Selection toolbar and save
  So that the formatting persists as a new ReportVersion

  # The formatting epic's single e2e round-trip (PRD #295 / ticket #297),
  # restored once previews wire VIEW_ORIGIN so the cross-origin Save is
  # exercisable (issue #307, ADR-0085). The browser tier
  # (tests/browser/selection-toolbar.spec.ts, ADR-0079) already proves the
  # toolbar's behavior against the mounted editor hermetically — what only THIS
  # tier can prove is the full journey across the deployed system: a real owner
  # session (Clerk), the app→view edit-token hand-off, the toolbar dispatching a
  # real ProseMirror command in the deployed editor, the cross-origin Save (view
  # browser JS → app API, Bearer edit token, ADR-0063 Phase 4), the new
  # ReportVersion appearing on the API, and the saved formatting surviving
  # reassembly + the scan pipeline back onto the live document.
  #
  # Same gating idioms as editor-auth.feature: runs under `chromium-auth`
  # (authenticated storageState page), needs PLAYWRIGHT_VIEW_BASE_URL (the
  # deployed view preview) and E2E_SCAN_DRAIN_SECRET (previews have no scan
  # cron — the scenario drives POST /internal/scan-drain itself, both to make
  # the upload servable and to promote the SAVED version to live before
  # asserting on it). Absent locally → skips cleanly; in CI a skip FAILS
  # (skip-guard.ts), because there it means the preview wiring broke.
  #
  # The selection gesture is a DOUBLE-CLICK (word selection), mirroring the
  # browser tier: synthetic held-button drags wedge Chromium against the
  # sandboxed editing iframe (documented in selection-toolbar.spec.ts's
  # header), and double-click exercises the same seam end-to-end.
  Scenario: Bold via the toolbar, Save, and the new version carries the formatting
    Given a bolded-word report I own has been uploaded and scanned clean
    And I have opened that report in the unified editor
    When I select a word of the report body
    And I bold the selection with the toolbar's Bold button
    And I save the formatted document
    Then a new report version exists for the formatted report
    And the live document renders the bolded word in strong
