// Node-render smoke test for the presentational toast stack (#336). The stack is
// prop-driven (the ToastRegion island owns the state; this owns the look), so
// server-rendering it to a string exercises the whole markup contract with no
// browser. Remix <Link> is mocked to a plain <a> — this asserts STRUCTURE, not
// navigation.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    h("a", { href: to, ...rest }, children),
}));

const { ToastStack } = await import("./ToastStack");
type ToastDescriptor = import("./toast").ToastDescriptor;

const render = (toasts: ToastDescriptor[]) =>
  renderToStaticMarkup(h(ToastStack, { toasts, onDismiss: () => {} }));

describe("ToastStack", () => {
  it("renders each toast's title, description, and action link", () => {
    const html = render([
      {
        id: "t1",
        tone: "success",
        title: "Report moved",
        actionLabel: "View",
        actionHref: "/?folder=q3",
      },
      { id: "t2", tone: "neutral", title: "Report deleted", description: "Q3 hiring plan" },
    ]);
    expect(html).toContain("Report moved");
    expect(html).toContain("View");
    expect(html).toContain('href="/?folder=q3"');
    expect(html).toContain("Report deleted");
    expect(html).toContain("Q3 hiring plan");
  });

  it("gives a danger toast an assertive alert role (via arp-ui Toast)", () => {
    const html = render([{ id: "e", tone: "danger", title: "Upload failed" }]);
    expect(html).toContain('role="alert"');
  });

  it("renders nothing when there are no toasts", () => {
    expect(render([])).toBe("");
  });

  it("offers a dismiss control per toast", () => {
    const html = render([{ id: "t1", tone: "success", title: "Folder created" }]);
    expect(html).toContain("Dismiss");
  });
});
