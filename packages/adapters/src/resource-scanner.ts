// ReportHtmlResourceScanner — the ResourceScanner port (#365), backed by the
// scan that reads the Viewer CSP allowlist itself.
//
// The third of the write-time questions, beside ReportHtmlEditabilityProbe
// (ADR-0080, "can the editor open these bytes?") and ReportHtmlFidelityProbe
// (ADR-0090, "would it keep them?"). This one asks what the VIEWER will do:
// which of the document's external references the ADR-0088 CSP will refuse to
// load. It exists as a port for the reason its two siblings do — answering
// needs an HTML parser, and `arp-application` is dependency-locked (ADR-024).
//
// It delegates to `arp-report-html`'s `scanBlockedResources`, which reads
// `VIEW_CSP_ALLOWLIST` — the same object `viewHeaders()` builds the policy
// from — rather than a second list of hosts that would drift the first time
// the real one was widened.
//
// SECURITY (ADR-0069): the uploaded document is UNTRUSTED CONTENT. Nothing on
// this path dereferences what it finds — no HEAD request, no DNS lookup, no
// reachability check. The method is synchronous so that it cannot.
//
// It never rejects an upload. A report that reaches past the allowlist still
// stores, still versions, and is still served byte-for-byte; naming the
// reference only lets its author fix it while they still hold the document.

import type {
  BlockedExternalResource,
  ResourceScanner,
  SandboxStorageAccess,
} from "arp-application";
import { scanBlockedResources, scanSandboxStorageAccess } from "arp-report-html";

export class ReportHtmlResourceScanner implements ResourceScanner {
  /**
   * @param viewOrigin the origin reports are served from on this deployment
   * (`VIEW_ORIGIN` — the same value `view_url` is built from). Every fetch
   * directive in the ADR-0088 policy begins with `'self'`, so a reference an
   * author wrote out in full against this origin loads and is not a warning.
   *
   * Optional, and deliberately not defaulted: previews and dev leave
   * `VIEW_ORIGIN` unset, and inventing an origin there would clear resources
   * the viewer really does refuse. The DEPLOYMENT knows this, not the
   * application layer — `arp-application` stays dependency-locked (ADR-024)
   * and never learns the platform's URLs to ask the question.
   */
  constructor(private readonly viewOrigin?: string) {}

  scan(entryDocument: Uint8Array): readonly BlockedExternalResource[] {
    // UTF-8 with `fatal: false` (the default): malformed bytes become U+FFFD
    // rather than throwing, so the scan stays total. The stored bytes are
    // untouched either way — this decode is local to answering the question.
    return scanBlockedResources(new TextDecoder().decode(entryDocument), {
      viewOrigin: this.viewOrigin,
    });
  }

  scanSandbox(entryDocument: Uint8Array): readonly SandboxStorageAccess[] {
    // Same UTF-8, `fatal: false` decode as `scan`: malformed bytes become
    // U+FFFD rather than throwing, so the scan stays total. The stored bytes
    // are untouched — this decode is local to answering the question, and needs
    // no view origin because a storage read is not a URL (ADR-0092, #385).
    return scanSandboxStorageAccess(new TextDecoder().decode(entryDocument));
  }
}
