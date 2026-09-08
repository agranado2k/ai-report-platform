// Node-render smoke: the upload form renders drop-zone-first, with the paste
// path retained behind a <details> disclosure, a destination-folder select, and
// a Title field (#337, report Z0W60dI8hu §03). Remix's <Form>/<Link> are mocked
// (no router at render); the title-derivation logic is covered by
// upload-title.test.ts, and the drop/paste interactivity by e2e/browser (the
// ADR-0079 harness is editor-only, so it can't mount apps/app — see the PR).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  // Render <Form>/<Link> as plain host elements so their children show up in the
  // static markup; the real components need a router context we don't stand up.
  Form: (props: Record<string, unknown>) => h("form", props),
  Link: (props: Record<string, unknown>) => h("a", props),
}));

const { UploadForm } = await import("./UploadForm");

const folders = [
  { id: "folder_root", name: "Root" },
  { id: "folder_q3", name: "Q3 planning" },
];

describe("UploadForm", () => {
  it("leads with a drop zone and its size hint", () => {
    const html = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: false }),
    );
    expect(html).toContain("Drop an .html file here");
    expect(html).toContain("Up to 25 MB");
    // A real file input backs the drop zone / browse affordance.
    expect(html).toMatch(/<input[^>]+type="file"/);
  });

  it("retains the raw-HTML paste path behind a disclosure", () => {
    const html = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: false }),
    );
    expect(html).toContain("<details");
    expect(html).toContain("Or paste HTML instead");
    // The paste textarea posts as `html`, so the MCP/CLI paste path is intact.
    expect(html).toMatch(/<textarea[^>]+name="html"/);
  });

  it("offers a destination folder select carrying every folder, root preselected", () => {
    const html = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: false }),
    );
    expect(html).toMatch(/<select[^>]+name="folderId"/);
    expect(html).toContain('value="folder_q3"');
    expect(html).toContain("Q3 planning");
  });

  it("renders a Title field defaulting to the document's own title", () => {
    const html = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: false }),
    );
    expect(html).toMatch(/<input[^>]+name="title"/);
    expect(html).toContain("Defaults to the document");
  });

  it("shows the Upload report submit and disables it while busy", () => {
    const idle = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: false }),
    );
    expect(idle).toContain("Upload report");

    const busy = renderToStaticMarkup(
      h(UploadForm, { folders, defaultFolderId: "folder_root", busy: true }),
    );
    expect(busy).toContain("disabled");
    expect(busy).toContain("Uploading");
  });
});
