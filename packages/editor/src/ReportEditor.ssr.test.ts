// Regression test for the `/reports/{slug}/edit` 500 (ReferenceError: DOMParser
// is not defined). `ReportEditor` is server-rendered by Remix during SSR on the
// Node serverless function, where the browser `DOMParser` global does not exist.
// `buildIframeDocument` (which parses with `DOMParser` since the CSP-bypass fix)
// must therefore NEVER run during render — it's deferred to a client mount
// effect. This test renders the component with `renderToString` in the node
// environment (no DOMParser) and asserts it does not throw and does not emit the
// client-only iframe `srcDoc`. It FAILS against the old `useMemo(buildIframeDocument)`
// (which ran during render → threw) and passes with the effect-deferred build.
//
// Uses `createElement` (not JSX) so it needs no JSX transform in the repo's
// node-only vitest environment.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportEditor } from "./ReportEditor";

describe("ReportEditor SSR safety", () => {
  const shell = {
    pre: "<!doctype html><html><head><style>body{color:red}</style></head><body>",
    post: "</body></html>",
  } as const;
  // initialDoc is only read inside the mount effect (never during render), so
  // any shape is fine for an SSR-render test.
  const initialDoc = { type: "doc", content: [] } as unknown as never;

  it("server-renders without touching the browser DOMParser (no throw)", () => {
    expect(() =>
      renderToString(createElement(ReportEditor, { initialDoc, shell, onChange: () => {} })),
    ).not.toThrow();
  });

  it("emits an <iframe> but defers srcDoc (report CSS) to the client", () => {
    const html = renderToString(
      createElement(ReportEditor, { initialDoc, shell, onChange: () => {} }),
    );
    expect(html).toContain("<iframe");
    // srcDoc is built client-side only, so the untrusted shell CSS must not be
    // present in the server-rendered markup.
    expect(html).not.toContain("body{color:red}");
  });
});
