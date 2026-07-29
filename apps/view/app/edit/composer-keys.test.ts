// Composer keyboard ergonomics + keystroke isolation (comment-UX adoptions,
// item C, and the gap-analysis report's slide-deck lesson applied to today's
// surface). Two behaviors under test:
//
//   1. ⌘/Ctrl+Enter submits, Esc cancels — in every comment composer.
//   2. ISOLATION: keystrokes inside a composer must NEVER reach
//      document/editor-level keyboard handlers — propagation stops on EVERY
//      keydown — but preventDefault fires ONLY for the two action keys. The
//      report documents the exact trap: a guard that preventDefaults
//      character/space/arrow keys while the caret is in the textarea
//      silently breaks typing.
import { describe, expect, it } from "vitest";
import { composerKeyAction, handleComposerKeyDown } from "./composer-keys";

interface FakeEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  stopPropagation(): void;
  preventDefault(): void;
  stopped: number;
  prevented: number;
}

function fakeEvent(key: string, mods: { meta?: boolean; ctrl?: boolean } = {}): FakeEvent {
  const e: FakeEvent = {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    stopped: 0,
    prevented: 0,
    stopPropagation() {
      this.stopped += 1;
    },
    preventDefault() {
      this.prevented += 1;
    },
  };
  return e;
}

describe("composerKeyAction", () => {
  it("maps ⌘+Enter and Ctrl+Enter to submit", () => {
    expect(composerKeyAction(fakeEvent("Enter", { meta: true }))).toBe("submit");
    expect(composerKeyAction(fakeEvent("Enter", { ctrl: true }))).toBe("submit");
  });

  it("maps Escape to cancel", () => {
    expect(composerKeyAction(fakeEvent("Escape"))).toBe("cancel");
  });

  it("maps everything else — including plain Enter (a newline) — to none", () => {
    expect(composerKeyAction(fakeEvent("Enter"))).toBe("none");
    expect(composerKeyAction(fakeEvent("a"))).toBe("none");
    expect(composerKeyAction(fakeEvent(" "))).toBe("none");
    expect(composerKeyAction(fakeEvent("ArrowLeft"))).toBe("none");
  });
});

describe("handleComposerKeyDown", () => {
  function run(e: FakeEvent) {
    const calls: string[] = [];
    handleComposerKeyDown(e, {
      onSubmit: () => calls.push("submit"),
      onCancel: () => calls.push("cancel"),
    });
    return calls;
  }

  it("submits on ⌘/Ctrl+Enter, with both stopPropagation and preventDefault", () => {
    const e = fakeEvent("Enter", { meta: true });
    expect(run(e)).toEqual(["submit"]);
    expect(e.stopped).toBe(1);
    expect(e.prevented).toBe(1);
  });

  it("cancels on Escape, with both stopPropagation and preventDefault", () => {
    const e = fakeEvent("Escape");
    expect(run(e)).toEqual(["cancel"]);
    expect(e.stopped).toBe(1);
    expect(e.prevented).toBe(1);
  });

  it("stops propagation of EVERY other key WITHOUT preventDefault (the typing trap)", () => {
    for (const key of ["a", " ", "ArrowLeft", "ArrowDown", "Enter", "Backspace"]) {
      const e = fakeEvent(key);
      expect(run(e)).toEqual([]);
      expect(e.stopped).toBe(1); // isolation: never reaches the document/editor
      expect(e.prevented).toBe(0); // typing/caret movement stays native
    }
  });
});
