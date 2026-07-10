// Renders an already-reassembled, untrusted report HTML document (View mode,
// or a version-diff's HTML reinjected into the report's shell) inside a
// FULLY sandboxed iframe (unified-experience epic, F-1 — claude-review #183 /
// ADR-0063's "4c client" note). This is the read-only sibling of
// `ReportEditor`'s own sandboxed `srcDoc` iframe: same CSP-injection
// mechanism (`buildReadOnlyIframeDocument`, arp-editor), but `sandbox=""` —
// NOT `sandbox="allow-same-origin"` — because nothing here ever needs
// `contentDocument` access (no ProseMirror mount, just a static render), so
// the maximally restrictive sandbox (opaque origin, no scripts, no forms, no
// same-origin) applies with no functional cost.
//
// `buildReadOnlyIframeDocument` calls the browser's native `DOMParser`
// (comment-aware — the whole point of the CSP-injection fix it shares with
// `buildIframeDocument`), which doesn't exist during Remix SSR — so, exactly
// like `ReportEditor.tsx`, `srcDoc` is computed in a client-only mount
// effect, never at render time. SSR and the first client render both emit an
// `<iframe>` with no `srcDoc` (no hydration mismatch); the effect then fills
// it in.
import { buildReadOnlyIframeDocument } from "arp-editor";
import { useEffect, useState } from "react";

export interface SandboxedHtmlProps {
  /** A FULL HTML document string — typically `reinjectShell(shell, bodyHtml)`
   *  (arp-report-html) — never a bare body fragment. */
  readonly html: string;
  readonly title: string;
  readonly className?: string;
}

export function SandboxedHtml({ html, title, className }: SandboxedHtmlProps) {
  const [srcDoc, setSrcDoc] = useState<string>();

  useEffect(() => {
    setSrcDoc(buildReadOnlyIframeDocument(html));
  }, [html]);

  return <iframe title={title} sandbox="" srcDoc={srcDoc} className={className} />;
}
