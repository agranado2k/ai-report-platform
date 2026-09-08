// Node-render smoke test for the new-folder dialog island (#336). SSR renders the
// trigger button and the native <dialog> (closed, content in the DOM). Asserts
// the STRUCTURE: the trigger, the title, the hidden `new-folder` intent + parent,
// the name field, and the create/cancel actions. Remix <Form> is mocked to a
// plain <form>. The open/close INTERACTION (showModal / the palette event) is
// browser-only and out of the node tier (ADR-0079).
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Form: ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children),
}));

const { NewFolderDialog } = await import("./NewFolderDialog");

const render = (error: string | null = null) =>
  renderToStaticMarkup(h(NewFolderDialog, { parentId: "q3", parentLabel: "Q3 planning", error }));

describe("NewFolderDialog", () => {
  it("renders a trigger, a dialog, and the new-folder form wiring", () => {
    const html = render();
    expect(html).toContain("+ New folder");
    expect(html).toContain("<dialog");
    expect(html).toContain('value="new-folder"'); // the intent the action handles
    expect(html).toContain('value="q3"'); // hidden parentId
    expect(html).toContain('placeholder="New folder in Q3 planning"');
    expect(html).toContain("Create folder");
    expect(html).toContain("Cancel");
  });

  it("surfaces a create error with an alert role", () => {
    const html = render("A folder named that already exists here.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("already exists");
  });
});
