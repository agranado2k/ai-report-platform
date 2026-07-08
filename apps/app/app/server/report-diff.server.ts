// The visual-diff mode decision (ADR-0065 §3, PR #156 review Fix 2) —
// factored out of reports.$slug.diff.tsx so the fallback-degradation
// behavior is unit-testable (the extracted-server-helper pattern used by
// open-report.server.ts's ownerOpenLocation): given both versions' body HTML
// and their optional `_source.json` sidecars, decide between the structural
// diff (diffRendered, when both sidecars parse and conform to reportSchema)
// and the labeled HTML fallback (diffHtmlFallback) — degrading to the
// fallback rather than throwing (and 500ing the whole page) when a sidecar
// is missing, truncated, or otherwise doesn't parse/conform. A hostile-but-
// well-formed sidecar is NOT this function's job to catch: that's
// diff-security.test.ts's battery over diffRendered/diffDocs themselves
// (packages/report-html/src/diff-security.test.ts) — this function only
// guards against the JSON.parse/schema-conformance failure mode.
import { diffHtmlFallback, diffRendered, type PMDocJson } from "arp-report-html";

export interface ReportDiffInputs {
  readonly fromBodyHtml: string;
  readonly toBodyHtml: string;
  readonly fromSidecarBytes: Uint8Array | null;
  readonly toSidecarBytes: Uint8Array | null;
}

export interface ReportDiffResult {
  readonly mode: "structural" | "fallback";
  readonly html: string;
  readonly label: string | null;
}

export function computeReportDiff(inputs: ReportDiffInputs): ReportDiffResult {
  if (inputs.fromSidecarBytes && inputs.toSidecarBytes) {
    try {
      const fromDoc = JSON.parse(new TextDecoder().decode(inputs.fromSidecarBytes)) as PMDocJson;
      const toDoc = JSON.parse(new TextDecoder().decode(inputs.toSidecarBytes)) as PMDocJson;
      const html = diffRendered(fromDoc, toDoc);
      return { mode: "structural", html, label: null };
    } catch {
      // Truncated/non-JSON bytes (JSON.parse) or JSON that doesn't conform to
      // reportSchema (Node.fromJSON inside diffRendered/diffDocs) — degrade
      // to the fallback below instead of letting the loader throw and 500.
    }
  }

  const fallback = diffHtmlFallback(inputs.fromBodyHtml, inputs.toBodyHtml);
  return { mode: "fallback", html: fallback.html, label: fallback.label };
}
