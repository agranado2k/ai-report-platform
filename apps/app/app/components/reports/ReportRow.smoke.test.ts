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
    expect(html).toContain("abc");
    expect(html).toContain("Root");
  });
  it("a published report is openable — the stretched-link overlay to /open", () => {
    expect(render({ isPublished: true })).toContain('href="/reports/abc/open"');
  });
  it("a processing (unpublished) report is inert — no open overlay", () => {
    expect(render({ isPublished: false })).not.toContain("/reports/abc/open");
  });
});
