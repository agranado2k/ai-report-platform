// Node-render smoke test for the delete-report confirm dialog island (#336). SSR
// renders the trigger and the native <dialog> (closed, content in the DOM).
// Asserts the STRUCTURE: the trigger, the confirm copy naming the report, and the
// hidden `delete-report` intent + slug/folder/title the action reads. Remix <Form>
// is mocked. The showModal INTERACTION is browser-only (ADR-0079).
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Form: ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children),
}));

const { DeleteReportDialog } = await import("./DeleteReportDialog");

const render = () =>
  renderToStaticMarkup(
    h(DeleteReportDialog, { slug: "hiring-plan", title: "Q3 hiring plan", folder: "q3" }),
  );

describe("DeleteReportDialog", () => {
  it("renders a trigger and a confirm dialog naming the report", () => {
    const html = render();
    expect(html).toContain("Delete report");
    expect(html).toContain("<dialog");
    expect(html).toContain("Delete report?");
    expect(html).toContain("Q3 hiring plan");
    expect(html).toContain("can’t be undone");
  });

  it("wires the delete-report intent with slug, folder and title", () => {
    const html = render();
    expect(html).toContain('value="delete-report"');
    expect(html).toContain('value="hiring-plan"'); // slug
    expect(html).toContain('value="q3"'); // folder
    expect(html).toContain('value="Q3 hiring plan"'); // title (for the toast)
  });
});
