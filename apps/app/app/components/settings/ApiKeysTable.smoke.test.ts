// Node-render smoke for the API keys table (#338, report §04). Remix's Form is
// mocked (no router/action at render). Pins the table semantics + columns, that
// an active key exposes a revoke Form posting intent=revoke with its id, that a
// revoked key is inert (dimmed, no revoke), and the empty state.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@remix-run/react", () => ({
  Form: ({ children, ...rest }: { children?: ReactNode }) => h("form", rest, children),
}));

const { ApiKeysTable } = await import("./ApiKeysTable");

const active = {
  id: "key_1",
  name: "Claude · laptop",
  keyPrefix: "arp_9f2a",
  scopes: ["reports:write"],
  createdAt: Date.UTC(2026, 7, 12),
  lastUsedAt: null,
  revokedAt: null,
};
const revoked = {
  id: "key_2",
  name: "Old laptop",
  keyPrefix: "arp_03ce",
  scopes: ["reports:write"],
  createdAt: Date.UTC(2026, 5, 3),
  lastUsedAt: Date.UTC(2026, 6, 30),
  revokedAt: Date.UTC(2026, 7, 1),
};

const render = (keys: unknown[]) =>
  renderToStaticMarkup(h(ApiKeysTable, { keys: keys as never, busy: false }));

describe("ApiKeysTable", () => {
  it("renders a table with the §04 columns", () => {
    const html = render([active]);
    expect(html).toContain("<table");
    for (const col of ["Key", "Scopes", "Created", "Last used"]) {
      expect(html).toContain(col);
    }
  });
  it("an active key exposes a revoke Form posting intent=revoke with its id", () => {
    const html = render([active]);
    expect(html).toContain('value="revoke"');
    expect(html).toContain('value="key_1"');
    expect(html).toContain("Revoke");
    expect(html).toContain("Claude · laptop");
    expect(html).toContain("arp_9f2a");
  });
  it("a revoked key is dimmed and carries no revoke control for its id", () => {
    const html = render([revoked]);
    expect(html).toContain("Revoked");
    expect(html).not.toContain('value="key_2"');
    expect(html).toContain("opacity");
  });
  it("shows an em dash for a never-used key", () => {
    expect(render([active])).toContain("—");
  });
  it("renders an empty state when there are no keys", () => {
    const html = render([]);
    expect(html).not.toContain("<table");
    expect(html.toLowerCase()).toContain("no keys");
  });
});
