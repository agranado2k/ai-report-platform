// Node-render smoke test for the ADR-0087 content-header management panel. SSR
// renders the header + the Manage disclosure and, when the roster is present,
// the management body. Asserts STRUCTURE: the badge, the Manage gate, the Root
// hush, the roster + share/unshare + visibility toggle + bulk-apply + rename +
// delete wiring. `useFetcher` is mocked; the component calls it TWICE (manage,
// then write), so the mock hands the manage fetcher first and the write fetcher
// second, per render. The open/close INTERACTION (onToggle → fetcher.load) and
// the live write round-trip are browser-only and out of the node tier (ADR-0079,
// covered by the rewritten folder-sharing.feature).
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FolderManageNode } from "./FolderManagePanel";

const state = vi.hoisted(() => ({
  manageData: undefined as unknown,
  writeData: undefined as unknown,
  call: 0,
}));

vi.mock("@remix-run/react", () => ({
  useFetcher: () => {
    const isManage = state.call++ % 2 === 0;
    const Form = ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children);
    return {
      data: isManage ? state.manageData : state.writeData,
      state: "idle",
      load: () => {},
      submit: () => {},
      Form,
    };
  },
}));

const { FolderManagePanel } = await import("./FolderManagePanel");

const NOTICES = {
  inertShareNotice: "INERT",
  rosterUnavailableNotice: "ROSTER-DOWN",
  personShareLimitNotice: "PERSON-LIMIT",
};

const node = (over: Partial<FolderManageNode> = {}): FolderManageNode => ({
  id: "fldr_abc",
  name: "Q3 planning",
  visibility: "private",
  isRoot: false,
  manageable: true,
  blockedReason: null,
  badge: { label: "Private", tone: "neutral", title: "Only you can see this folder." },
  shareWarning: null,
  cascadeLabel: null,
  ...over,
});

const manageContext = (over: Record<string, unknown> = {}) => ({
  object: "folder_manage_context",
  shares: [
    { email: "a@x.test", grantedAt: "2026-09-08" },
    { email: "b@x.test", grantedAt: "2026-09-08" },
  ],
  reportSharing: { visibleCount: 4, overCap: false },
  badge: { label: "Shared with 2", tone: "brand", title: "shared with 2 people" },
  formKey: "private:2",
  ...over,
});

function render(n: FolderManageNode, manageData: unknown = undefined, writeData: unknown = undefined) {
  state.call = 0;
  state.manageData = manageData;
  state.writeData = writeData;
  return renderToStaticMarkup(h(FolderManagePanel, { node: n, ...NOTICES }));
}

describe("FolderManagePanel (ADR-0087)", () => {
  it("renders nothing for the Root folder — no name, no management chrome", () => {
    expect(render(node({ isRoot: true, name: "Root" }))).toBe("");
  });

  it("shows the name + badge but NO Manage for a non-manageable folder, with the reason", () => {
    const html = render(node({ manageable: false, blockedReason: "You don't own this folder." }));
    expect(html).toContain("Q3 planning");
    expect(html).toContain("Private"); // the count-less badge
    expect(html).toContain("own this folder."); // apostrophe HTML-escaped by SSR
    expect(html).not.toContain(">Manage");
  });

  it("gates the Manage disclosure on `manageable`", () => {
    expect(render(node({ manageable: true }))).toContain(">Manage");
  });

  it("before the roster loads, prompts to open — never a phantom empty roster", () => {
    const html = render(node());
    expect(html).toContain("Open to load this folder");
    expect(html).not.toContain("Shared with"); // no roster claim yet
  });

  it("upgrades the badge and renders the roster once the manage payload is loaded", () => {
    const html = render(node(), manageContext());
    expect(html).toContain("Shared with 2"); // the loaded badge
    expect(html).toContain("a@x.test");
    expect(html).toContain("b@x.test");
    expect(html).toContain("Remove");
  });

  it("wires the visibility toggle, the roster share form and the rename/delete controls", () => {
    const html = render(node(), manageContext());
    expect(html).toContain('value="set-folder-visibility"');
    expect(html).toContain("Share with the whole org"); // private → org direction
    expect(html).toContain('value="share-folder"');
    expect(html).toContain("Share Q3 planning with an email address");
    expect(html).toContain('value="rename-folder"');
    expect(html).toContain('value="delete-folder"');
    expect(html).toContain("Delete (must be empty)");
  });

  it("offers the counted bulk-apply for the reports inside", () => {
    const html = render(node(), manageContext());
    expect(html).toContain("The reports inside");
    expect(html).toContain('value="apply-folder-sharing"');
    expect(html).toContain("4 reports");
  });

  it("renders the cascade checkbox with its counted, direction-aware label", () => {
    const html = render(node({ cascadeLabel: "Also share the 3 folders inside this one with the whole org" }), manageContext());
    expect(html).toContain("Also share the 3 folders inside this one");
    expect(html).toContain('name="cascade"');
  });

  it("shows THE warning before the action when the server composed one", () => {
    const html = render(node({ shareWarning: "You'll become this folder's owner." }), manageContext());
    expect(html).toContain("become this folder"); // apostrophe HTML-escaped by SSR
  });

  it("renders a write outcome in its data-driven tone (partial ⇒ warning)", () => {
    const html = render(node(), manageContext(), {
      folderId: "fldr_abc",
      error: null,
      summary: "Set to private, 1 inside not changed.",
      partial: true,
      tone: "warning",
    });
    expect(html).toContain("text-warning");
    expect(html).toContain("Set to private, 1 inside not changed.");
  });
});
