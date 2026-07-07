import type { NodeSpec } from "prosemirror-model";
import { getDomEnvironmentDocument } from "../dom-environment.js";

/**
 * `sec` node (ADR-0062 §3) — a section heading, `<h2 class="sec">`, carrying
 * the numbered section label (e.g. "1") as a `secnum` attribute rather than
 * as an inline child. The fixture always nests it as
 * `<span class="secnum">N</span>` immediately followed by the heading text;
 * `secnum` is lifted out of content and into an attr so it's addressable
 * (e.g. for a future "renumber sections" editing feature) instead of being
 * indistinguishable text content.
 */
export const secNode: NodeSpec = {
  group: "block",
  content: "inline*",
  attrs: { secnum: { default: "" } },
  parseDOM: [
    {
      tag: "h2.sec",
      // Higher than the default-50 priority of schema-basic's generic `h2`
      // heading rule (registered earlier in the schema), which would
      // otherwise also match `<h2 class="sec">` and win on insertion order.
      priority: 60,
      getAttrs(dom: HTMLElement) {
        return { secnum: dom.querySelector(".secnum")?.textContent ?? "" };
      },
      contentElement(dom: HTMLElement) {
        const clone = dom.cloneNode(true) as HTMLElement;
        clone.querySelector(".secnum")?.remove();
        return clone;
      },
    },
  ],
  // A declarative array `DOMOutputSpec` can't express "static prefix content
  // (the secnum badge), then a content hole" — ProseMirror requires a
  // content hole to be the *only* child of its parent in that form. Build
  // the DOM by hand instead: append the secnum span first, then hand back
  // `{dom, contentDOM: dom}` so the node's own inline content is appended as
  // further siblings, exactly matching the fixture's flat markup.
  toDOM(node) {
    const document = getDomEnvironmentDocument();
    const dom = document.createElement("h2");
    dom.setAttribute("class", "sec");
    const secnum = document.createElement("span");
    secnum.setAttribute("class", "secnum");
    secnum.textContent = node.attrs.secnum;
    dom.appendChild(secnum);
    return { dom, contentDOM: dom };
  },
};
