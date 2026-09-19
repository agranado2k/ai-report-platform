import { describe, expect, it } from "vitest";
import { scanSandboxStorageAccess } from "./sandbox-scan.js";

/** The APIs a finding names, in first-seen order, so a test reads as a list. */
const apis = (html: string): readonly string[] => scanSandboxStorageAccess(html).map((a) => a.api);

/** Wrap a script body in the smallest document the scanner will parse. */
const doc = (script: string, attrs = ""): string =>
  `<!doctype html><html><head><script${attrs ? ` ${attrs}` : ""}>${script}</script></head><body></body></html>`;

describe("scanSandboxStorageAccess — top-level storage reads in inline scripts (#385)", () => {
  it("flags an unguarded top-level localStorage read", () => {
    expect(apis(doc(`const t = localStorage.getItem("theme");`))).toEqual(["localStorage"]);
  });

  it("flags an unguarded top-level sessionStorage read", () => {
    expect(apis(doc(`sessionStorage.setItem("slide", "3");`))).toEqual(["sessionStorage"]);
  });

  it("flags an unguarded top-level document.cookie read", () => {
    expect(apis(doc(`const c = document.cookie;`))).toEqual(["document.cookie"]);
  });

  it("flags a document.cookie WRITE too — the setter throws just the same", () => {
    expect(apis(doc(`document.cookie = "seen=1";`))).toEqual(["document.cookie"]);
  });

  it("flags window.localStorage — the qualified global getter throws all the same", () => {
    expect(apis(doc(`if (window.localStorage) { render(); }`))).toEqual(["localStorage"]);
  });

  it("flags a computed document['cookie'] access", () => {
    expect(apis(doc(`const c = document["cookie"];`))).toEqual(["document.cookie"]);
  });

  it("flags a read inside a TOP-LEVEL IIFE — it runs synchronously before paint", () => {
    expect(apis(doc(`(function () { const t = localStorage.getItem("t"); })();`))).toEqual([
      "localStorage",
    ]);
  });

  it("does NOT flag a read guarded by try/catch — guarding is the recommended fix", () => {
    expect(apis(doc(`try { const t = localStorage.getItem("theme"); } catch {}`))).toEqual([]);
  });

  it("does NOT flag a read inside a function that is only defined, not called", () => {
    expect(
      apis(doc(`function remember() { localStorage.setItem("x", "1"); } el.onclick = remember;`)),
    ).toEqual([]);
  });

  it("does NOT flag a read inside a deferred callback (addEventListener)", () => {
    expect(
      apis(doc(`window.addEventListener("load", () => { const c = document.cookie; });`)),
    ).toEqual([]);
  });

  it("does NOT read the body of an EXTERNAL script (src present)", () => {
    // A src'd script has no inline body to analyse; its host is the resource
    // scan's concern, not this one.
    expect(
      apis(`<!doctype html><html><head><script src="/app.js"></script></head></html>`),
    ).toEqual([]);
  });

  it("does NOT analyse a non-JavaScript <script> (e.g. application/json data block)", () => {
    expect(apis(doc(`{ "localStorage": "document.cookie" }`, `type="application/json"`))).toEqual(
      [],
    );
  });

  it("deduplicates: one finding per distinct API even across scripts", () => {
    const html =
      doc(`localStorage.getItem("a"); localStorage.getItem("b");`) +
      doc(`const c = document.cookie; const d = document.cookie;`);
    // First-seen order across the document: localStorage, then document.cookie.
    expect(apis(html)).toEqual(["localStorage", "document.cookie"]);
  });

  it("is total: an inline script that does not parse contributes nothing, never throws", () => {
    expect(apis(doc(`const = = = ;;; not valid javascript`))).toEqual([]);
  });

  it("returns nothing for a self-contained report that touches no storage", () => {
    expect(apis(doc(`document.getElementById("app").textContent = "hi";`))).toEqual([]);
  });

  it("analyses a type=module script's top level (module scripts throw the same)", () => {
    expect(apis(doc(`export const t = localStorage.getItem("t");`, `type="module"`))).toEqual([
      "localStorage",
    ]);
  });
});
