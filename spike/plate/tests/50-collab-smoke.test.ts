import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { BaseYjsPlugin } from "@platejs/yjs";
import * as Y from "yjs";
import { l0Plugins } from "../src/editors/l0";

describe("Collab smoke check — @platejs/yjs (5 min budget, no server)", () => {
  it("installs and a Y.Doc instantiates without error", () => {
    const doc = new Y.Doc();
    expect(doc).toBeTruthy();
  });

  it("BaseYjsPlugin registers into an editor without error", () => {
    const yjsPlugin = BaseYjsPlugin.configure({
      options: {
        ydoc: new Y.Doc(),
      },
    });

    expect(() =>
      createSlateEditor({
        plugins: [...l0Plugins(), yjsPlugin],
      }),
    ).not.toThrow();
  });
});
