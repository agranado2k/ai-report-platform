// Node-render smoke test for the app shell (#333). The shell is prop-driven, so
// server-rendering it to a string exercises the whole markup contract with no
// browser and no Clerk context (the account control is an injected slot). Remix
// <Link> is mocked to a plain <a> so no router context is needed — this asserts
// STRUCTURE, not navigation. The rail-collapse INTERACTION (⌘B / localStorage)
// is covered by isRailToggle's unit test; renderToStaticMarkup runs no effects,
// so this is the expanded SSR baseline.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    h("a", { href: to, ...rest }, children),
}));

const { AppShell } = await import("./AppShell");
type NavFolder = import("./shell-nav").NavFolder;

const folders: NavFolder[] = [
  { id: "root", parentId: null, name: "Root" },
  { id: "q3", parentId: "root", name: "Q3 planning" },
];

const render = (path: string, selectedFolderId: string | null = null) =>
  renderToStaticMarkup(
    h(
      AppShell,
      { navFolders: folders, activePath: path, selectedFolderId, account: h("div", {}, "ACCOUNT") },
      h("p", {}, "PAGE BODY"),
    ),
  );

describe("AppShell", () => {
  it("renders sidebar brand, primary nav, folders, settings, account, and the page body", () => {
    const html = render("/");
    expect(html).toContain("Centaur");
    expect(html).toContain("Reports");
    expect(html).toContain("Shared with me");
    expect(html).toContain("Recent");
    expect(html).toContain("Q3 planning"); // folder nav tree from navFolders
    expect(html).toContain("API keys &amp; MCP");
    expect(html).toContain("ACCOUNT"); // injected account slot (no Clerk needed)
    expect(html).toContain("PAGE BODY"); // outlet children
    expect(html).toContain("Upload report");
  });
  it("marks Reports active on the dashboard via aria-current", () => {
    expect(render("/")).toContain('aria-current="page"');
  });
  it("renders a breadcrumb nav and a sidebar collapse control", () => {
    const html = render("/");
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("Collapse sidebar");
  });
  it("Shared with me / Recent are shown but not linked (unbuilt)", () => {
    const html = render("/");
    expect(html).toContain("soon");
  });
});
