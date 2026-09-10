# ADR-0089: The owner view — first-party chrome over the byte-for-byte report

- **Status**: Accepted (2026-09-10) — amends ADR-0038 (a third route profile on the viewer
  origin), ADR-0056/ADR-0059 §4 (**only** in where an owner *lands*; the owner-open
  redirect flip itself is #363, not this record), and ADR-0079 §4 (§7 — "hermetic" is
  narrowed to "nothing outside the process", so the tier may bind a loopback server)
- **Deciders**: operator
- **Date**: 2026-09-10
- **Relates to**: ADR-002/ADR-013 (viewer origin isolation + the security-header stack),
  ADR-0063 (in-viewer editing — the gate, the capability-cookie pattern and the `oa=`
  owner degrade this record reuses), ADR-0088 (`frame-ancestors 'self'`, without which
  none of this is possible), ADR-0069 (the trust boundary this containment argument is
  written against), ADR-0080 (`Editability` stays advisory — nothing here routes on it)

## Context and problem statement

A report published to Centaur Spec is served byte-for-byte at the canonical
`view.<domain>/<slug>` (ADR-0038). That is the contract and it is not negotiable: what
the author uploaded is what every visitor gets, under the ADR-013 sandbox.

The consequence is that the canonical URL has **nowhere to put a first-party control**.
There is no title bar, no "who is this shared with?", no way to reach version history, no
Edit affordance — because adding any of them would mean injecting bytes the author did not
write into the document the author published. So the owner of a report has, until now,
been routed somewhere else entirely: since ADR-0063 Phase 5, clicking a report in the
dashboard lands the owner in `/<slug>/edit`, the ProseMirror editor.

That routing is what the 2026-09-09 spike went looking at, and it is worse than it sounds.
The editor is not a viewer. Its schema drops `<script>`, flattens `<svg>` and strips
`class` from `<section>` (ADR-0062 §3). A slide deck that renders perfectly as the artifact
it was generated as arrives in the editor as a flat wall of text. **The owner is the one
principal who cannot see their own report as they published it.** Everyone holding a share
link sees the real thing; the owner sees the editor's reduction of it.

The obvious fix — put chrome on the canonical URL for owners — reopens the byte-for-byte
contract, and does it *conditionally on who is asking*, which is worse than doing it
uniformly. The other obvious fix — leave the viewer bare and keep every control on the
dashboard — is what we have, and it is why the owner reaches for Edit to *look at*
something.

The question this ADR settles: **can the owner get first-party chrome around their report
without any byte of that chrome touching the report, and without giving the report
anything it did not already have?**

## Decision drivers

- **The byte-for-byte contract is untouchable.** Whatever we build must leave
  `GET /<slug>` responding exactly as it does today, for every principal.
- **The owner should see what a share-link visitor sees.** Not a rendition, not a
  reduction — the same bytes, in the same sandbox, running the same script.
- **The viewer origin's security model is "nothing here to compromise."** ADR-0063 already
  spent some of that on `/edit`. A second authenticated surface has to be argued for on the
  same terms, not waved through because a precedent exists.
- **The interface has to be buildable against.** Tickets #363 (owner-open flip), #364
  (lossy confirm dialog) and #366 land on top of this one. The gate decision and the
  cookie hand-off are the seam they consume, so they have to be *decided here*, not
  discovered later.

## Considered options

1. **A bare viewer with Edit only on the dashboard** (the status quo). Rejected — it is
   the state that produced the problem. The owner's only in-context action is Edit, so Edit
   is what they click when they wanted to look.
2. **Chrome on the canonical URL, for everyone.** Rejected — it breaks ADR-0038's
   byte-for-byte contract outright, and makes the platform's core artifact something we
   rewrite rather than something we host.
3. **Chrome on the canonical URL, for owners only.** Rejected, and more firmly than (2):
   it makes the response body depend on the requester's credentials, so the report an owner
   proofreads is provably not the report their reader gets. It also puts first-party markup
   inside the top-level `sandbox` CSP, where it would run in an opaque origin alongside
   untrusted script.
4. **A host reset injected into the report bytes** — the artifact host's
   `[hidden]{display:none!important}` and friends, prepended at serve time. Rejected: same
   contract breach as (2), and it silently changes the rendering of documents that were
   correct without it. (The `[hidden]` defect the spike reproduced is real and is
   #362's problem — a *fidelity verdict surfaced to the author*, not a rewrite.)
5. **A separate authenticated route that frames the canonical one.** Chosen.

## Decision outcome

### 1. A third route on the viewer origin: `GET view.<domain>/<slug>/view`

The **owner view**: a thin first-party chrome strip above the canonical `/<slug>`,
embedded in a sandboxed iframe. The chrome carries the report title, its share state, a
way to reach versions, and an Edit action. Below it, in the frame, is the report — the
same bytes, the same response, the same ADR-013 headers a share-link visitor gets.

The route file is **`apps/view/app/routes/$slug_.view.tsx`**. The trailing `_` is
load-bearing and is pinned by a structural test, for the same reason `$slug_.edit.tsx`'s
is (ADR-0063 Phase 5-F): as `$slug.view.tsx` it would nest under the public viewer, whose
loader would unlock-wall a private report before this loader ever ran.

`GET /<slug>` is **unchanged** — not one byte, not one header, beyond what ADR-0088
already changed. That is the property this whole design exists to preserve, and it is
pinned by a regression test.

### 2. The iframe contract (settled by the 2026-09-09 spike, Chromium 148)

```html
<iframe
  src="/<slug>#<forwarded hash>"
  sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
  allow="fullscreen"
></iframe>
```

Every token is there for a reason, and the absences matter more than the presences:

- **No `allow-same-origin`.** The framed document runs in an **opaque origin**. The spike
  confirmed that inside the frame `document.cookie` throws `SecurityError` and
  `parent.document` throws `SecurityError`. This is the containment.
- **No `allow-top-navigation`, no `allow-top-navigation-by-user-activation`.** The framed
  report cannot navigate the chrome page away. A report cannot redirect the owner to a
  phishing page, and cannot replace the surface it is being judged on.
- **`allow-scripts`** is the point of the exercise: the report is meant to run.
  `allow-scripts` without `allow-same-origin` is the safe combination — the
  script runs, and has no origin to reach anything from.
- **`allow-forms`, `allow-popups`, `allow-popups-to-escape-sandbox`** buy artifact parity:
  a report's ordinary `target="_blank"` link opens an ordinary page rather than a
  sandboxed one. The opened page is a separate top-level context, not a hole in this frame.
- **`allow="fullscreen"`** is load-bearing and was verified negatively: without it,
  `requestFullscreen()` throws `TypeError: Disallowed by permissions policy` and
  `document.fullscreenEnabled` is `false`. A deck that cannot go fullscreen is not a deck.
- **The `src` carries no token.** The framed navigation is same-site, so it carries the
  path-scoped `arp_unlock` cookie on its own (spike Q1). §4 is what makes sure that cookie
  is there.
- **The chrome forwards its own URL hash into the `src`**, so `/<slug>/view#3` lands on
  slide 3, and **focuses the iframe on load**, so arrow keys reach the deck without a
  click.

### 3. The gate: a third purpose, not a third gate

`decideServe` (`apps/view/app/server/gate.server.ts`) remains the ONE viewer gate.
`Purpose` gains `"ownerView"`, returning a new `OwnerViewDecision`:

```ts
export type OwnerViewCapability = "write" | "ownerRead";

export type OwnerViewDecision =
  | {
      readonly kind: "serve";
      readonly report: Report;
      readonly version: ReportVersion;
      /** "write" → the Edit action is offered. "ownerRead" → read-only chrome. */
      readonly capability: OwnerViewCapability;
      readonly degradeTo: string;
      readonly ownerFallback: boolean;
    }
  | TerminalArms; // error | redirect | setCookieAndRedirect — shared with the other two
```

The decision chain mirrors `decideEdit`'s, arm for arm, because the capability is the
same capability — a valid `Edit token` proves the app ran its `canWrite` check at mint
time. **The owner view never consults `report.acl`**, exactly as `/edit` never does. The
decision matrix:

| Who | What they present | Decision |
| --- | --- | --- |
| canWrite (owner or grantee) | valid `et=` on the query | `setCookieAndRedirect` → §4 |
| canWrite | valid `arp_view` cookie | `serve`, `capability: "write"` |
| owner, capability **absent**, verified `oa` | `arp_view_oa` cookie or `oa=` query | `serve`, `capability: "ownerRead"` — read-only chrome, **no Edit action**, **+ `arp_unlock`** (§4c) |
| anyone, capability **rejected** (expired/tampered/rotated secret) | — | `redirect` → `{appOrigin}/reports/{slug}/open` (the funnel) |
| anonymous / unauthorised | nothing | `redirect` → the same funnel, which bounces them to the app home → sign-in |
| no funnel available (no secret / no `appOrigin`), no `oa` | — | `redirect` → the bare `/{slug}` |
| no `appOrigin`, verified `oa` | `arp_view_oa` cookie or `oa=` query | `redirect` → `/{slug}?access=<oa>` — the owner degrade, not the bare viewer. The chrome is never rendered without an `appOrigin` (its header profile needs one for `connect-src`, so it fails closed), but an owner holding a working read capability is still walked through it rather than past it. Note a missing *secret* cannot reach this row: without one nothing can verify an `oa`, so that case is the row above. |
| report deleted / flagged / not found / mid-scan / lookup failed | — | degrade to the public viewer, which owns that state machine (ADR-0038 §2) |

Two things are deliberately inherited rather than re-decided:

- **The rejection-vs-absence routing** (ADR-0063 Phase 5-G). A *rejected* capability
  funnels to the mint even when a verified `oa` is in hand, because a rejection says the
  round-trip is what broke and the mint is what repairs it. An *absence* with a verified
  `oa` degrades. Re-deciding this here would fork a rule two production incidents paid for.
- **No report-existence leak.** Every unauthorised outcome is the same `redirect` an
  unauthorised `/edit` request gets, decided before the report is ever looked up in the
  `absent`/`rejected` arms. A visitor cannot tell a private report from a nonexistent one.

The `"ownerRead"` arm is a small **improvement** on today's `oa` degrade, not a new
capability: today an owner whose edit round-trip fails is dumped on the bare
`/{slug}?access=<oa>` with no chrome at all. The token, the check
(`acceptOwnerFallback`: valid HMAC, this slug, unexpired, `owner === true`, 1 KiB cap) and
the resulting access are identical — they now arrive with a title bar.

**"Same access" is a claim the serve arm has to pay for, not an aspiration.** This arm is
reached with no hand-off behind it — the capability is *absent*, so §4's 303 never ran —
and the framed `GET /<slug>` carries `arp_unlock` and nothing else. A `serve` that set no
cookie would therefore wrap chrome around the **unlock wall** for every non-`public`
report, granting strictly *less* than the bare `/{slug}?access=<oa>` it claims to improve
on, where `decideView`'s `grant` branch does redeem the cookie. So the `serve` arm carries
a `cookies` list and issues that same redemption. It is written as **one rule over both
capabilities** — any serve holding a verified `oa` issues it — rather than as an
`ownerRead` special case: on the `write` arm it is a harmless refresh of what the 303
already set, and a rule that holds on every arm cannot rot when the matrix grows a row,
which the Consequences name as this design's failure mode. Only `arp_unlock` may ever
appear in that list; a capability cookie there would be §4(a)'s exact violation.

### 4. The cookie hand-off — the interface #363 builds against

`GET /<slug>/view?et=<edit token>[&oa=<owner access token>]` answers **303** to the clean
`/<slug>/view`, dropping both tokens out of the address bar, history and referer. It sets:

| Cookie | Path | Max-Age | Purpose |
| --- | --- | --- | --- |
| `arp_view` | `/<slug>/view` | the edit token's remaining life | the owner view's own capability |
| `arp_view_oa` | `/<slug>/view` | same | the verified owner fallback, surviving the query strip |
| `arp_unlock` | `/<slug>` | the **`oa` token's** remaining life | **so the framed `GET /<slug>` serves** |

All three are `HttpOnly; Secure; SameSite=Lax`, and `arp_view_oa` is percent-encoded so
its value can never split the `Set-Cookie` header — the `arp_edit`/`arp_edit_oa` posture,
unchanged. The last two are set only when an `oa` was presented **and verified**.

Three decisions are embedded here and each was a real fork in the road.

**(a) The capability cookie is scoped to `Path=/<slug>/view`, never to `Path=/<slug>`.**
This is the whole reason the design is safe. Broadening it to `/<slug>` would put an
authenticated write capability on **the exact request the sandboxed iframe makes** — the
one carrying untrusted report bytes. ADR-0063 refused that broadening for `arp_edit` when
there was no iframe in the picture; with one, refusing it is not a preference, it is the
containment. The framed request carries `arp_unlock` and nothing else.

**(b) The Edit action is a plain link to `/<slug>/edit`; this route sets no cookie under
that path.** The tempting alternative was to redeem the same `et=` into an `arp_edit`
cookie at the same 303, saving a hop. Rejected. Following the link with no `arp_edit`
cookie and no `oa` cookie at that path yields `deniedEdit(cause: "absent", oa: undefined)`
→ `canFunnel && !oa` → the funnel to `{appOrigin}/reports/{slug}/open`, which is **the
app's one edit-token mint** and re-checks `canWrite` **live**. So the extra hop is not a
cost we are tolerating; it is the revocation property, bought back. A grant revoked while
the owner view sits open stops working when Edit is clicked, rather than at the next
save. Note the ordering dependency this relies on: no `oa` under `/<slug>/edit` is what
makes that branch funnel rather than degrade, so **`arp_view_oa` must stay scoped to
`/<slug>/view`**. A test pins it.

**(c) `arp_unlock` is issued on the happy path — and, per §3, on any `serve` holding a
verified `oa` — and that is a bounded widening, not a reduction.** Today an owner reaching `/edit` never gets an `arp_unlock` cookie; the `oa`
token is redeemed only on a degrade, via `/{slug}?access=<oa>`. Under the owner view the
frame *needs* that cookie, so the happy path issues it. What is added: an owner's browser
holds a report-scoped read capability for up to the `oa` token's life (`OWNER_TTL_SECONDS`,
24h) after merely opening the owner view. What is **not** added: no new token, no new
mint, no new claim shape, and no new Path — the cookie is byte-identical in name, value,
scope and Max-Age to the one `decideView`'s existing `grant` branch already produces from
the same token. It is also strictly less exposed on this path than on the one it replaces,
because the token never reaches the address bar. The widening is bounded by
`acceptOwnerFallback` verifying before anything is written, by `HttpOnly` (report script
cannot read it, and in an opaque origin cannot reach `document.cookie` at all), and by
`Path=/<slug>` keeping it to one report. **Shortening `OWNER_TTL_SECONDS` is the lever**
if 24h is judged too wide; ADR-0056 already notes it is re-minted on every dashboard click.

**Capping it to the edit token's ~15 minutes was considered and rejected**: the frame
would then start bouncing to the unlock wall *inside the iframe* mid-session, which is a
confusing failure in the one place the user cannot see the URL.

### 5. Headers: ADR-0063's authenticated profile, reused unchanged

The route responds with **`editViewHeaders({ appOrigin })`** — `packages/headers` is not
modified by this ADR. That profile already carries exactly what this route needs, and the
fit is not a coincidence: it is the viewer origin's *authenticated first-party* profile,
and this is the viewer origin's second authenticated first-party route.

- **`Origin-Agent-Cluster: ?1`** — required by the ticket and by the spike, which observed
  Chromium warning that the chrome page was **site**-keyed while the framed report
  requested origin-keying. Both documents must agree or the origin is not uniformly keyed.
- **No second, top-level `sandbox` CSP header.** `viewHeaders()` would be wrong here for
  the same reason ADR-0063 gives for `/edit`: that header exists to drop *untrusted report
  bytes* into an opaque origin, and this document is our own. The report keeps it — in the
  frame, where it belongs, as a second mechanism independent of the `sandbox` attribute.
- **`frame-src 'self'`** — already present, and what permits the frame at all from this
  side. `frame-ancestors 'self'` on the report's own response (ADR-0088) is what permits
  it from the other side. Both are required; neither is added here.
- **`frame-ancestors 'none'`** on the chrome page itself: the owner view is wholly
  unframeable. A report cannot frame the chrome, and neither can anything else.
- **`Cache-Control: no-store`** — authenticated and per-user.

Naming: `editViewHeaders` now serves two routes and its name has narrowed past its
meaning. Renaming it to something like `authenticatedViewHeaders` is a **recorded
mechanical follow-up — #375**, deliberately not done here: a rename across a
security-header surface does not belong in the same diff as a new authenticated route.

### 6. Why the chrome page is safe to be non-sandboxed (ADR-0069)

The viewer origin's model was "nothing here to compromise." ADR-0063 spent part of that on
`/edit` and flagged it open for `/security-review`. This route is the second withdrawal,
so the argument is made explicitly rather than by precedent.

**The chrome page renders no untrusted content.** That is the entire claim, and it is
narrow enough to check. The only report-derived values it renders are the **title** and
the **share-state label**, both as React text nodes — never `dangerouslySetInnerHTML`,
never a `srcDoc`, never an attribute interpolation. Every byte the author wrote is on the
far side of the iframe boundary, in an opaque origin that cannot reach back.

**It holds no capability worth stealing.** Unlike `/edit`, which deliberately hydrates the
edit token into the page so client JS can call the app-origin API with it, the owner view
has **no cross-origin data plane** and therefore **puts no token in its loader payload**.
Its capability lives entirely in `HttpOnly` cookies the page's own JS cannot read. This is
the security dividend of the route being thin, and it is a constraint on what may be added
to it later: giving the owner view a client-side API call would mean re-opening this
paragraph.

So the two directions of attack both close:

- *Report → chrome*: blocked by the opaque origin (no `allow-same-origin`), by the absent
  top-navigation permissions, by `HttpOnly` on every cookie, and by `Path` scoping that
  keeps the write capability off the frame's own request.
- *Chrome → report*: there is nothing to send. The chrome never reads the report's bytes,
  never postMessages into it, and does not need to.

Note the shape of the spike itself, per ADR-0069 §4: it ran against a throwaway local
server, never against fetched third-party content, and its code was deleted. The findings
in ADR-0088 and here are the record.

### 7. The browser tier gains a served origin (amends ADR-0079 §4)

ADR-0088's Evidence note promises the framing contract's regression test lands here. It
cannot land in the tier as ADR-0079 left it. That tier is `file://`-only — an esbuild IIFE
bundle inlined into a generated page — and **both halves of the contract are
unexpressible over `file://`**: cookies need a real origin, and `frame-ancestors 'self'`
has no meaning without one. A `srcDoc` iframe is not the thing under test either; the
thing under test is a **real navigation to `/<slug>`** carrying a real `Path`-scoped
cookie.

ADR-0079 §4 says "no deployment, no auth, no database… a test in this directory that needs
a server is in the wrong directory." That sentence is **narrowed, not overturned**: what
makes the tier hermetic is that it needs *nothing outside the process* — no deployment, no
credentials, no database, no network. An ephemeral `node:http` server bound to
`127.0.0.1` on an OS-assigned port, started and killed inside the spec, satisfies every one
of those. It is the same instrument the 2026-09-09 spike used to establish the contract in
the first place.

So the tier gains its first served-over-HTTP project, `owner-view-framing`. Its server
serves the header stack **from the real exported builders** (`viewHeaders()`,
`editViewHeaders()`) rather than a restated string — the ADR-0088 rule, kept: a test that
restates the policy proves only that someone typed it twice.

### 8. Known limitation: a write-grantee on a gated report

A non-owner `canWrite` user is deliberately never minted an `oa` — an `owner: true` claim
for a non-owner is the privilege escalation ADR-0063 review #146 caught. So a grantee
reaches the owner view with `capability: "write"` and full chrome, but for a report in
`private`/`password`/`allowlist` mode the **framed** `GET /<slug>` is gated on its own
merits and will show the unlock hand-off inside the frame. For `public`, and for `org`
where the mode admits them, the frame simply works.

This is **not** blocking: until #363 flips owner-open, nothing routes anyone here by
default. The recorded door is a grantee-safe read capability minted by the app — a
scope-bound, mode-independent read token that is explicitly **not** `owner: true` — which
is a decision for its own ticket, not a thing to improvise inside this route. That ticket
is **#376**, and it should be decided before or alongside #363, which is the change that
makes this reachable. It is named here so #363 does not discover it as a surprise.

### 9. What this ADR does not decide

- **The owner-open redirect flip** (#363) — where `GET {app}/reports/{slug}/open` sends an
  owner. This record defines the landing surface and its hand-off; the flip is #363's.
  What #363 needs from here: keep appending `&oa=` for owners (§4c depends on it), and
  point at `/<slug>/view?et=…&oa=…`.
- **The lossy-edit confirm dialog** (#364). The Edit action here is a plain navigation.
- **The fidelity verdict and upload warnings** (#362) — including the `[hidden]` defect
  the spike reproduced. Nothing here reads or routes on `Editability` (ADR-0080 §4 stands).

## Consequences

- The owner finally sees their own report as published. The regression that started this —
  a deck reduced to flat text — is gone for the *viewing* path.
- The viewer origin now has **two** authenticated routes. The "nothing here to compromise"
  model is now a claim that needs re-checking on every addition, not a structural fact. §6
  is the standing form of that check.
- A third `Purpose` in `decideServe` keeps the one-gate property but grows the decision
  matrix. The matrix tests are the contract; adding an arm without adding its row is the
  failure mode to watch for.
- Three route profiles now exist on one origin (public / owner view / edit), and the
  header builder is named after only one of them. Follow-up recorded in §5.

## More information

- **Evidence** for the iframe contract: the 2026-09-09 spike, recorded in the diary and in
  ADR-0088's Evidence note (Chromium 148.0.7778.96, Playwright 1.60.0, headless + headed).
  ADR-0088's note says the browser-tier regression test lands with this ticket; it does —
  `tests/browser/owner-view-framing.spec.ts`, over a hermetic local HTTP server, asserting
  both halves: a first-party view-origin page frames the report and the framed navigation
  carries the unlock cookie; a sandboxed report in an opaque origin that tries to frame
  another report is refused by `frame-ancestors 'self'` and its navigation carries no
  unlock cookie. The `file://` harness the tier used until now cannot express either half
  — cookies and `frame-ancestors` both need a real origin — so the tier gains its first
  served-over-HTTP project.
- Implementation: `apps/view/app/routes/$slug_.view.tsx` (loader + chrome),
  `apps/view/app/server/gate.server.ts` (`purpose: "ownerView"`, `OwnerViewDecision`, the
  `arp_view` / `arp_view_oa` cookie builders), `apps/view/app/view/components/` (the
  chrome), `packages/headers` **unchanged**.
- Glossary: **owner view** is added to `docs/domain-glossary.md` in the same change.
