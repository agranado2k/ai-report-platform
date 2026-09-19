# ADR-0092: The owner-view fallback control, and the `sandbox-incompatible` upload warning

- **Status**: Accepted (2026-09-19) — **amends ADR-0089** (adds one always-present control
  to the owner-view chrome) and **extends the closed `Upload warning` set of ADR-0088 / #365**
  with a third code. Touches neither the iframe contract of ADR-0089 §2 nor the CSP of
  ADR-0088: containment is unchanged.
- **Deciders**: operator
- **Date**: 2026-09-19
- **Relates to**: ADR-0089 (the owner view — the sandboxed frame this record adds an escape
  hatch beside), ADR-0088 (the viewer CSP and the second `sandbox` header — untouched here),
  ADR-0091 (the grantee's `arp_unlock` redemption, which makes the top-level `/<slug>` serve
  for a grantee too), ADR-0069 (the trust boundary the heuristic scan is written against),
  ADR-0024 (why the scan reaches `packages/application` through a port), ADR-0080 / ADR-0090
  / #365 (the two sibling write-time questions and the warning mechanism this extends)

## Context and problem statement

ADR-0089 gives a report's owner first-party chrome around the byte-for-byte report: a
sandboxed iframe at `view.<domain>/<slug>/view` framing the canonical `GET /<slug>`. The
frame withholds `allow-same-origin` on purpose — that absence is the containment (ADR-0089
§2, ADR-0091). The consequence, confirmed on Chromium 148: inside that opaque origin
`localStorage`, `sessionStorage` and `document.cookie` each **throw `SecurityError` on
access**.

A large genre of agent-authored artifacts reads one of those before first paint — theme
persistence, "last slide" memory, a bit of analytics — in an inline bootstrap that also
builds or reveals the document. When that read is unguarded, the throw aborts the bootstrap
and the frame renders **completely blank**: a 200 that shows nothing. The deck that
motivated PRD #356 (ZmsH1iKiTl) hits it. Verified: the same deck with the storage read
wrapped in `try/catch` paints; unwrapped, blank.

Two distinct people are hurt, at two distinct times:

- **The reader**, now, looking at a blank owner view with nothing on screen to say why or
  what to do. The raw `/<slug>` URL is unaffected — it is a top-level document, not
  sandboxed — but the reader in the owner view has no way to reach it.
- **The author**, earlier, who published a report that will blank in the owner view and was
  never told, and who by the time a reader notices no longer has the document in hand.

This is not a one-line fix. `allow-same-origin` cannot be added back — that is the whole
containment model, and re-adding it is exactly the review-#146 / lethal-trifecta escalation
the sandbox exists to prevent (ADR-0089 §2, ADR-0069). So the question is not how to make
the frame run this code; it is **how to handle a report that cannot run under the frame's
guarantees, without loosening those guarantees**.

## Decision drivers

- **Containment is not on the table.** No `allow-same-origin`, no CSP relaxation, the
  framed report stays opaque-origin. Whatever we add lives entirely outside the frame.
- **The reader must never be left staring at a blank frame with no way out.** The escape
  has to be reliable, not a guess about whether a given report blanked.
- **The author should learn before publishing**, in a form an agent can act on — MCP is
  this product's primary write surface, and an agent that reads a code can guard the access
  and re-upload before a human opens the report.
- **A heuristic must not become a gate.** Detection of "reads storage at the top level" is
  inherently approximate; it must never reject an upload, change a status code, or fetch
  anything (ADR-0069).

## Considered options

### For the reader

1. **Active blank-detection.** The chrome watches the frame and, on a detected error or a
   stayed-blank frame, offers the escape. **Rejected.** The frame is a different (opaque)
   origin, so the chrome cannot read its `load`/`error` state, its `document`, or its
   painted pixels — every signal it could use is exactly what the containment removes.
   Heuristics over frame size or timing are unreliable and would both miss real blanks and
   fire on slow-but-fine reports. A control that appears only when a fragile guess says so
   is worse than one that is simply always there.
2. **An always-present fallback control.** The chrome always shows an unobtrusive "Open in
   new tab" control that opens `/<slug>` as a **top-level document** (`target="_blank"`,
   `rel="noopener"`). **Chosen.** No detection is attempted; the control costs one small,
   always-visible link and is correct for every report, blank or not. It works because the
   owner-view hand-off has already set the `arp_unlock` cookie at `Path=/<slug>` (ADR-0089
   §4c, and for a grantee ADR-0091), so a top-level `GET /<slug>` from the same browser
   serves the report directly — and at top level it is a real origin where storage and
   cookies work. Verified by dogfooding the hand-off. (If that assumption were ever false,
   the escape would land on the unlock wall rather than the report — a degraded escape, not
   a containment breach.)

### For the author

3. **Authoring guidance only** — document "wrap storage access in `try/catch`; the owner
   view frame is storage-less" in the MCP tool description and docs. **Rejected as
   sufficient on its own** — it does nothing for a report already published and nothing at
   the moment an agent is about to publish a broken one. (Kept as a complement: the detail
   text carries the guidance.)
4. **Warn the author at upload only** — extend #365's `warnings[]` with a
   `sandbox-incompatible` code, and do nothing for the reader. **Rejected as the whole
   answer**: it leaves every already-published report, and every report whose author
   ignores the warning, with a blank owner view and no escape.
5. **A new `sandbox-incompatible` upload warning, alongside the reader fallback.**
   **Chosen** — option 2 for the reader, this for the author. Emitted when the uploaded
   document reads `localStorage`, `sessionStorage`, or `document.cookie` at the **top level
   of an inline `<script>`** (unguarded — not inside a function and not inside a `try`), via
   the existing `UploadScanner` port. Advisory exactly like its two siblings: it never
   fetches, never rejects, never changes the status code.

## Decision outcome

**Chosen: option 2 (the reader) + option 5 (the author). The sandbox is deliberately not
loosened.**

### 1. The fallback control (the reader)

`OwnerViewTopBar` (`apps/view/app/view/components/`) always renders an unobtrusive **"Open
in new tab"** control — an ordinary anchor to `/<slug>`, `target="_blank"`,
`rel="noopener"` — **regardless of `canEdit`**. It is present on the owner-read degrade too,
where it matters most, since that visitor already holds a working read capability
(ADR-0089 §3). It is a plain link, not a fetcher, consistent with the rest of this bar
(ADR-0089 §6): the owner view has no client-side data plane and this adds none.

Why it is safe and why it works, in one line each:

- **Works**: the framed navigation set `arp_unlock` at `Path=/<slug>` during the hand-off,
  so the same browser's top-level `GET /<slug>` carries it and serves the report; at top
  level the report is a real origin where `localStorage` / `cookie` work.
- **Safe**: it opens the report as its own top-level document — the same bytes every
  share-link visitor gets, under the same ADR-013/ADR-0088 headers. Nothing about the frame
  changes; `rel="noopener"` denies the opened page a handle back to the chrome.

### 2. The `sandbox-incompatible` upload warning (the author)

The closed `Upload warning` set (ADR-0088 / #365) gains a third code,
**`sandbox-incompatible`**, joining `external-resource-blocked` and `editor-lossy`. It is
emitted, one per distinct API, when the entry document reads or writes `localStorage`,
`sessionStorage`, or `document.cookie` at the top level of an inline `<script>` — a write
(`document.cookie = …`, `localStorage.setItem(…)`, `sessionStorage.clear()`) throws the
same `SecurityError` as a read in the opaque-origin frame (each dereferences the throwing
getter or the cookie setter), so the scan flags either. Its
`detail` names the specific API and tells the reader — usually an agent — that the owner
view runs the report in a storage-less sandboxed frame where that access throws, and to
guard it (feature-detect or `try/catch`) so the report still paints. The canonical
`/<slug>` URL is named as unaffected.

Mechanism, reusing #365's exactly:

- The scan reaches `packages/application` through the **`UploadScanner` port** (ADR-0024
  keeps the layer dependency-locked), which gains one method, `scanSandbox`, beside `scan`.
  The real predicate lives in `arp-report-html` (`scanSandboxStorageAccess`) next to
  `scanBlockedResources`, and the adapter bridges the two.
- It is assembled in `uploadReport`, in the one place that already holds the resource scan
  and the fidelity verdict, so the HTTP response and the MCP tool cannot drift. Ordering:
  blocked resources first (per-URL, document order), then `sandbox-incompatible`, then the
  `editor-lossy` summary last.
- **A scan, never a fetch** (ADR-0069): the method is synchronous — the uploaded document
  is untrusted content and a scan that cannot await cannot dereference what it reads. The
  detail text is bounded to a fixed enum of API names, so unlike a URL it carries no
  attacker-sized payload.

### 3. Why a real parser, not a token search

The heuristic uses an AST (`acorn`, already in the tree, linear-time — no ReDoS concern the
regex path in `resource-scan.ts` had to design around) rather than a substring search for
`localStorage`. The reason is false positives with a cost: the remediation this warning
recommends **is** wrapping the access in `try/catch`, so a token search would keep nagging
the author who already did the right thing, and warn about access inside a function that
never runs before paint. The parser lets the scan flag only what the failure actually needs
— an access that executes at top level, unguarded — which is the difference between a signal
and noise. It stays advisory and total: a script that will not parse contributes nothing.

### 4. What is explicitly unchanged

- **The iframe contract** (ADR-0089 §2): `sandbox="allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox"`, `allow="fullscreen"`, **no `allow-same-origin`**, no
  top-navigation. Not one token changes.
- **The CSP** (ADR-0088): `connect-src`, `frame-ancestors`, `script-src`, the second
  `sandbox` header — all untouched. `packages/headers` is not modified.
- **`GET /<slug>`**: byte-for-byte identical (ADR-0038). The fallback is a link to it, not a
  change to it.

## Consequences

- The reader always has a reliable, one-click escape from a frame that blanked, and never
  has to know in advance whether their report is one that will. The cost is one always-
  present control in the chrome, including on reports that render perfectly framed.
- The author (or their agent) learns at upload time, in an actionable code, that a report
  will blank in the owner view — closing the loop the reader fallback only mitigates.
- The `UploadScanner` port now answers two questions; the rename from `ResourceScanner` to
  reflect this was a deliberate mechanical follow-up (ticket #390), not part of a behavior
  diff (shared-invariants §; the ADR-0089 §5 precedent for #375).
- The heuristic will have false negatives (storage read via a computed property, an
  aliased global, `eval`) and false positives (a top-level read that the report's own logic
  makes unreachable). Both are acceptable because the warning is advisory and the reader
  fallback, not the warning, is what guarantees the reader is never stuck.

## More information

- Repro evidence: the ADR-0089 §2 / ADR-0088 spike (Chromium 148.0.7778.96) — `localStorage`
  / `sessionStorage` / `document.cookie` throw `SecurityError` in the no-`allow-same-origin`
  frame. This record adds no new browser experiment; it builds on that measurement.
- Implementation: `apps/view/app/view/components/OwnerViewTopBar.tsx` +
  `OwnerViewChrome.tsx` (the control); `packages/report-html/src/sandbox-scan.ts` (the
  heuristic); `packages/application/src/ports.ts` (`UploadScanner.scanSandbox`,
  `SandboxStorageAccess`), `packages/adapters/src/resource-scanner.ts` (the bridge),
  `packages/application/src/use-cases/upload-report.ts` (assembly + the new code).
- Proof: `tests/browser/owner-view-chrome.spec.ts` (the control is present and points at
  `/<slug>` with the right `rel`/`target`), `packages/report-html/src/sandbox-scan.test.ts`
  (the heuristic — guarded vs unguarded, function-scoped, each API), and the upload
  use-case + HTTP wire tests for the new code.
- Glossary: **Upload warning** is updated in the same change to name the third code.
