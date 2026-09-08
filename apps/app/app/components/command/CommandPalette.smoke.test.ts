// Node-render smoke test for the command palette island (#336). renderToStatic-
// Markup runs no effects, so the dialog SSRs closed but its content is in the DOM
// with the initial (empty-query) state — the full item list. This asserts the
// STRUCTURE contract: the search field, the grouped listbox, every action, the
// report/folder rows, and the footer key hints. Remix hooks are mocked (no
// router context). The interactive layer (chord, filter, ⌘Enter) is covered by
// command-palette.ts's unit tests.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  useNavigate: () => () => {},
  Link: ({ to, children }: { to: string; children?: ReactNode }) => h("a", { href: to }, children),
}));

const { CommandPalette } = await import("./CommandPalette");

const render = () =>
  renderToStaticMarkup(
    h(CommandPalette, {
      reports: [
        { slug: "q3-roadmap", title: "Q3 roadmap review" },
        { slug: "hiring-plan", title: "Q3 hiring plan" },
      ],
      folders: [{ id: "q3", name: "Q3 planning" }],
      mcpEndpoint: "https://mcp.centaurspec.com/mcp",
    }),
  );

describe("CommandPalette", () => {
  it("renders a native dialog with a search combobox and a listbox", () => {
    const html = render();
    expect(html).toContain("<dialog");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Search reports, folders, and actions");
  });

  it("shows the three global actions", () => {
    const html = render();
    expect(html).toContain("Upload a report");
    expect(html).toContain("New folder");
    expect(html).toContain("Copy MCP endpoint");
  });

  it("shows reports (with slug hint) and folders under grouped headers", () => {
    const html = render();
    expect(html).toContain("Q3 roadmap review");
    expect(html).toContain("q3-roadmap");
    expect(html).toContain("Q3 planning");
    expect(html).toContain("Actions");
    expect(html).toContain("Reports");
    expect(html).toContain("Folders");
  });

  it("renders the footer keyboard hints (navigate / open / new tab)", () => {
    const html = render();
    expect(html).toContain("navigate");
    expect(html).toContain("open");
    expect(html).toContain("new tab");
  });

  it("marks each row as a listbox option", () => {
    expect(render()).toContain('role="option"');
  });
});
