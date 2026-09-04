// Node-render smoke: the filter renders a labelled search input with the "/"
// hint. Remix's router hooks are mocked (no navigation happens at render); the
// debounce/URL logic is covered by report-filter.test.ts.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ search: "" }),
}));

const { ReportFilter } = await import("./ReportFilter");

describe("ReportFilter", () => {
  it("renders a labelled search input carrying the current query and the / hint", () => {
    const html = renderToStaticMarkup(h(ReportFilter, { defaultQuery: "q3" }));
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Filter reports by title or slug"');
    expect(html).toContain('value="q3"');
    expect(html).toMatch(/<kbd[^>]*>\/<\/kbd>/);
  });
});
