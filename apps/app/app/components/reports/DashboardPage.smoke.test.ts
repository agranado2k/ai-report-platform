// Node-render smoke for the dashboard body, extracted from the `_app._index`
// route so it is prop-driven. Remix's router hooks are mocked (no router at
// render). Pins what the route rendered before the extraction: the empty and
// no-match states, the Report rows as a list, and the cursor links that keep
// the search and the Folder selection (ADR-0053). The mounted, width-dependent
// behaviour is the browser tier's (tests/browser/report-list-mobile.spec.ts).
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => {
  const Form = ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children);
  return {
    Form,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
      h("a", { href: to, ...rest }, children),
    useFetcher: () => ({ Form, data: undefined, state: "idle", submit: () => {}, load: () => {} }),
    useNavigate: () => () => {},
    useLocation: () => ({ search: "" }),
  };
});

const { DashboardPage } = await import("./DashboardPage");
type Props = import("./DashboardPage").DashboardPageProps;

const folder = {
  id: "fold_1",
  parentId: null,
  name: "Root",
  visibility: "org" as const,
  isRoot: true,
  manageable: false,
  blockedReason: null,
  badge: { label: "Org", tone: "brand" as const, title: "Org" },
};
const report = {
  id: "report_1",
  slug: "abcde12345",
  title: "Q3 roadmap",
  isPublished: true,
  folderId: "fold_1",
  displayFolderId: "fold_1",
  editabilityNotice: null,
  fidelityNotice: null,
  sharing: {
    slug: "abcde12345",
    title: "Q3 roadmap",
    badge: { label: "Private", tone: "neutral", title: "Only you" },
    manageable: true,
    blockedReason: null,
    state: "private",
    discardWarning: null,
    formKey: "k",
  },
};
const base: Props = {
  folders: [folder],
  items: [report],
  hasPrev: false,
  hasNext: false,
  q: "",
  selectedFolderId: null,
  rootId: "fold_1",
  inertShareNotice: "",
  rosterUnavailableNotice: "",
  sharingChoices: [],
  personShareLimitNotice: "",
  reportOutcome: null,
  newFolderError: null,
};
const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(h(DashboardPage, { ...base, ...over }));

describe("DashboardPage", () => {
  it("lists Reports as list items under the page title", () => {
    const html = render();
    expect(html).toContain("Your reports");
    expect(html).toMatch(/<ul[^>]*>.*<li/s);
    expect(html).toContain("Q3 roadmap");
  });

  it("offers an upload when there are no Reports, and a clearer hint when a search matches none", () => {
    expect(render({ items: [] })).toContain("No reports here yet");
    expect(render({ items: [] })).toContain('href="/upload"');
    const noMatch = render({ items: [], q: "zzz" });
    expect(noMatch).toContain("No matching reports");
    expect(noMatch).not.toContain('href="/upload"');
  });

  it("keeps the search and the Folder selection on the cursor links", () => {
    const html = render({ q: "q3", selectedFolderId: "fold_1", hasNext: true, hasPrev: true });
    expect(html).toContain('href="/?q=q3&amp;folder=fold_1&amp;starting_after=report_1"');
    expect(html).toContain('href="/?q=q3&amp;folder=fold_1&amp;ending_before=report_1"');
  });
});
