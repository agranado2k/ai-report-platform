// @vitest-environment jsdom
// Interaction tests for the Selection toolbar's LINK EDITOR error paths
// (ticket #299) — the states the SSR smoke test (SelectionToolbar.test.ts)
// cannot reach because they live behind clicks: the editor-refused apply, the
// empty-URL submit, and the editor-refused remove. The browser tier proves
// the unsafe-URL rejection end-to-end (selection-toolbar.spec.ts); what THIS
// tier pins is that each refusal renders its `role="alert"` message and keeps
// the editor open for correction — with the host's apply/remove stubbed to
// refuse, which the browser tier's real editor never does on demand.
import type { ActiveFormats } from "arp-editor";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SelectionToolbar, type SelectionToolbarProps } from "./SelectionToolbar";

// React 18's createRoot warns (and skips act batching) without this flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GEOMETRY = {
  rect: { left: 100, top: 300, right: 260, bottom: 320 },
  surface: { left: 0, top: 53, right: 680, bottom: 700 },
};

const NO_FORMATS: ActiveFormats = {
  strong: false,
  em: false,
  link: false,
  linkHref: null,
  headingLevel: null,
  listKind: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(overrides: Partial<SelectionToolbarProps> = {}) {
  act(() => {
    root.render(
      createElement(SelectionToolbar, {
        geometry: GEOMETRY,
        formats: NO_FORMATS,
        onToggleFormat: () => {},
        onToggleHeading: () => {},
        onToggleList: () => {},
        onApplyLink: () => true,
        onRemoveLink: () => true,
        onCompose: () => {},
        ...overrides,
      }),
    );
  });
}

function click(label: string) {
  const button = container.querySelector(`[aria-label="${label}"]`);
  if (!button) throw new Error(`no '${label}' button is rendered`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeUrl(value: string) {
  const input = container.querySelector<HTMLInputElement>('[data-testid="link-url-input"]');
  if (!input) throw new Error("the link editor is not open");
  // Through the native value setter so React's own value tracker sees the
  // change and the `input` event reaches the controlled onChange.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no native value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submit() {
  const form = container.querySelector("form");
  if (!form) throw new Error("the link editor is not open");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

function editorOpen(): boolean {
  return container.querySelector('[data-testid="link-url-input"]') !== null;
}

describe("SelectionToolbar link editor — error paths", () => {
  it("an EMPTY submit renders the empty-URL message as role=alert and keeps the editor open", () => {
    mount();
    click("Link");
    expect(editorOpen()).toBe(true);

    submit();

    expect(alertText()).toBe("Enter a URL.");
    expect(editorOpen()).toBe(true);
    // The input is flagged for assistive tech too.
    expect(
      container.querySelector('[data-testid="link-url-input"]')?.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("an apply the EDITOR refuses renders the refused message and keeps the editor open", () => {
    // The host's onApplyLink contract documents `false` = the editor did not
    // apply (e.g. the selection is gone). The URL itself is valid, so the
    // failure is the editor's — the message must say so, not blame the URL.
    mount({ onApplyLink: () => false });
    click("Link");
    typeUrl("https://example.com");

    submit();

    expect(alertText()).toBe("The link couldn't be applied — reselect the text and try again.");
    expect(editorOpen()).toBe(true);
  });

  it("a remove the EDITOR refuses renders its message and keeps the editor open — same contract as apply", () => {
    // M-10: onRemoveLink's documented boolean must not be discarded — a
    // refused remove keeps the editor open with feedback, exactly like a
    // refused apply, instead of silently closing as if it had worked.
    mount({
      formats: { ...NO_FORMATS, link: true, linkHref: "https://example.com" },
      onRemoveLink: () => false,
    });
    click("Link");
    expect(editorOpen()).toBe(true);

    click("Remove link");

    expect(alertText()).toBe("The link couldn't be removed — reselect the text and try again.");
    expect(editorOpen()).toBe(true);
  });

  it("a SUCCESSFUL remove closes the editor with no error", () => {
    let removed = 0;
    mount({
      formats: { ...NO_FORMATS, link: true, linkHref: "https://example.com" },
      onRemoveLink: () => {
        removed += 1;
        return true;
      },
    });
    click("Link");
    click("Remove link");

    expect(removed).toBe(1);
    expect(editorOpen()).toBe(false);
    expect(alertText()).toBeNull();
  });
});
