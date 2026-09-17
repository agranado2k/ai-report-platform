// Node-render smoke for the extracted ReportRow (#335). Remix's Form/Link/
// useFetcher are mocked (no router/action at render); the subtree's real
// components (ReportSharingMenu, RenameReportForm, StatusBadge) render to
// markup. Pins the two behaviours the route had no unit seam for: the row is a
// semantic <li> (list semantics restored, #346), and a PROCESSING report is
// inert (no open overlay) while a published one is openable (#334).
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => {
  const Form = ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children);
  return {
    Form,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
      h("a", { href: to, ...rest }, children),
    useFetcher: () => ({ Form, data: undefined, state: "idle", submit: () => {} }),
  };
});

const { ReportRow } = await import("./ReportRow");

const sharing = {
  slug: "abc",
  title: "Q3",
  badge: { label: "Org", tone: "brand", title: "Shared with the org" },
  manageable: true,
  blockedReason: null,
  state: "org_view",
  discardWarning: null,
  formKey: "k1",
};
const base = {
  slug: "abc",
  title: "Q3 roadmap",
  folderId: "f1",
  displayFolderId: "f1",
  editabilityNotice: null,
  sharing,
};
const folders = [{ id: "f1", name: "Root" }];
const render = (over: { isPublished: boolean }) =>
  renderToStaticMarkup(
    h(ReportRow, {
      report: { ...base, ...over },
      folders,
      folderLabel: "Root",
      sharingChoices: [],
      pendingSharing: null,
    }),
  );

describe("ReportRow", () => {
  it("is a semantic <li> carrying the report title, slug and folder", () => {
    const html = render({ isPublished: true });
    expect(html).toMatch(/^<li/);
    expect(html).toContain("Q3 roadmap");
    expect(html).toMatch(/<code[^>]*>abc<\/code>/); // slug in the Name cell, not the href/sharing
    expect(html).toContain("Root");
  });
  it("a published report is openable — the stretched-link overlay to /open", () => {
    expect(render({ isPublished: true })).toContain('href="/reports/abc/open"');
  });
  it("a processing (unpublished) report is inert — no open overlay", () => {
    expect(render({ isPublished: false })).not.toContain("/reports/abc/open");
  });
  // #363 — Open and Edit are two distinct actions. Opening lands on the OWNER
  // VIEW (chrome above the byte-for-byte report); editing is an explicit,
  // separate act. Before the flip the row had ONE destination and it was the
  // editor, which is why an owner reached for Edit when they wanted to look.
  it("offers Edit as a distinct action, routed through the ONE mint asking for the editor", () => {
    const html = render({ isPublished: true });
    expect(html).toContain('href="/reports/abc/open?to=edit"');
    // Accessible name is "Edit <title>", built the way every other control in
    // this row builds one: visible text plus an sr-only suffix, so screen
    // readers get "Edit Q3 roadmap" out of a list of identical "Edit" links.
    expect(html).toMatch(/>Edit<span class="sr-only"> Q3 roadmap<\/span>/);
  });

  it("Open and Edit are DIFFERENT destinations — the row no longer has one meaning", () => {
    const html = render({ isPublished: true });
    // The stretched overlay (Open) carries no `to=`, so it takes the mint's
    // default: the owner view.
    expect(html).toContain('href="/reports/abc/open"');
    expect(html).toContain('href="/reports/abc/open?to=edit"');
  });

  it("a processing (unpublished) report offers NEITHER — the row stays inert until a clean version is live", () => {
    const html = render({ isPublished: false });
    expect(html).not.toContain("/reports/abc/open");
    expect(html).not.toContain("to=edit");
  });

  it("the Edit action is lifted above the stretched overlay, or the overlay would swallow its clicks", () => {
    // The overlay is `absolute inset-0`; any interactive cell has to sit at
    // z-10 to be clickable at all. A silently-unclickable Edit is exactly the
    // failure this row's existing `relative z-10` cells already guard against.
    //
    // Scoped to the anchor's IMMEDIATELY-ENCLOSING div, and deliberately so.
    // An earlier version sliced from 400 chars before the anchor to the END OF
    // THE DOCUMENT, which swept in the actions dropdown's own
    // `absolute right-0 z-10` further down the row — so deleting `z-10` from
    // the wrapper left this test green, and the only guard against the failure
    // it names did not work. A window that ends AT the anchor cannot reach
    // anything rendered after it, and starting at the nearest preceding `<div`
    // keeps the row's other `relative z-10` cells out of it too.
    const html = render({ isPublished: true });
    const at = html.indexOf('href="/reports/abc/open?to=edit"');
    expect(at, "the Edit anchor should be rendered for a published report").toBeGreaterThan(-1);
    const wrapper = html.slice(html.lastIndexOf("<div", at), at);
    expect(wrapper).toContain("relative z-10");
  });

  it("actions menu is keyboard-reachable (focus-within reveal, not hover-only) and holds the actions", () => {
    const html = render({ isPublished: true });
    expect(html).toContain("focus-within:opacity-100");
    expect(html).toContain("Delete report");
  });
});
