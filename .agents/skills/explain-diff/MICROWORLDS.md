# Micro-worlds — when an explanation should be playable

A **micro-world** is a small, manipulable model of the system embedded in the
explanation, where the reader learns by poking rather than reading. The idea
is Seymour Papert's ("living in Mathland"); the canonical non-software example
is the book *Secret Colors*, which teaches key exchange through paint-mixing —
a toy world faithful to the *concept* while ignoring every implementation
detail. That is the design bar for everything below:

> **Simulate the model, not the code.** Reimplement the essence of the changed
> behavior in a few dozen lines of inline JavaScript over toy data. Fidelity
> to the concept is what teaches; fidelity to the implementation is what the
> Code section's links are for.

## When to build one — and when not to

Build a micro-world only when the load-bearing concept of the change is
**dynamic** — time, concurrency, state transitions, feedback loops, load. A
static change (a rename, a schema field, a copied file, reshuffled docs) is
explained perfectly well by the diagram families the skill already prescribes,
and a toy bolted onto it is decoration.

**One world per explanation, not one per section.** A micro-world is the most
expensive element on the page to build and the most expensive to trust. Spend
it on the single concept the quiz would test — the thing the reader must hold
to review the change — and let diagrams carry the rest. If two concepts
genuinely compete, the explanation is probably covering two changes, and that
is worth saying out loud instead.

## The catalog

Roughly ordered by how diff-native each is:

- **Before/after twin worlds** — two side-by-side simulations, old behavior
  and new, driven by *one* shared set of controls. The reader feeds input and
  watches where the worlds diverge: the diff made visible as behavior, not
  text. Add a "revert the fix" toggle so the reader can reproduce the bug the
  change kills. *For:* bug fixes, behavior changes, algorithm swaps.
- **Predict-then-run** — the quiz upgraded into a world: "given this input,
  what does the new code return?" The reader commits a prediction, *then*
  runs the toy and sees. Predict–observe–explain is a far stronger
  comprehension check than recognizing the right option in a list. *For:* any
  change with a computable output; composes with the Quiz section.
- **Algorithm theater** — an animated step-through of the changed algorithm
  over toy data, with play/pause/speed/step-frame controls. *For:* changes to
  *how* something computes — placement, scheduling, retries, dedup, caching.
- **Fault-injection toys** — buttons on the system diagram that *cause* the
  edge case the diff exists to handle: "kill the worker", "delay the
  network", "send the webhook twice" — and the fix visibly absorbing it.
  *For:* resilience and error-handling changes.
- **State-machine playground** — the states rendered, events fired by
  clicking, illegal transitions refused with the reason. *For:* lifecycle
  changes — order status, auth flows, job queues.
- **Data-shape inspector** — an editable toy payload or table; the page
  re-runs the (simulated) transformation live, spreadsheet-style. *For:*
  migrations, serializers, query changes.
- **Trace scrubber** — no simulation at all: a *recorded* execution trace
  from a real test run, embedded as inline JSON, with a timeline scrubber.
  Higher fidelity, zero drift risk — the honest option when the behavior is
  too subtle to fake. *For:* concurrency and ordering subtleties.
- **Counterfactual toggles** — one control per design decision, wired to the
  decision records: flip "what if we had used optimistic locking" and watch
  the failure the chosen design avoids. This makes `docs/adr/` playable.
  *For:* changes whose real content is a decision.
- **Living glossary** — hovering a domain term highlights its instances in
  the toy data and diagrams, grounding `docs/domain-glossary.md` in
  manipulables. *For:* changes that introduce or rename domain vocabulary.

## The honesty rules

These are not optional; a micro-world that breaks them is worse than no
micro-world.

1. **A wrong world is cognitive debt with a UI.** Simulation drift — the toy
   confidently modeling behavior the code no longer has — is exactly the debt
   this skill exists to pay down, made more convincing by interactivity.
   Anchor the toy to truth: derive it from the same test fixtures the diff
   added or changed, or use a trace scrubber instead of a simulation.
2. **Label the fidelity.** Every world carries a visible caption in the form
   "toy model, ~40 lines, not the real code", and each behavior it exhibits
   links to the real `file:line` that implements it.
3. **Play it before shipping it.** Exercise every control and confirm the
   world behaves as the explanation claims — a broken toy destroys the
   reader's trust in the whole page. The self-check is the same one the skill
   already runs on code blocks, extended to interaction.
4. **Self-contained, like everything else on the page.** Inline JS, inline
   toy data, no network. A world that phones home is a world that dies the
   day the endpoint does.

---

*This sidecar is the kit's own synthesis. The micro-world idea is Seymour
Papert's (Mindstorms, "Mathland"), carried into agent-era explanations by
[Geoffrey Litt](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck)
and by [Simon Willison's interactive-explanations pattern](https://simonwillison.net/guides/agentic-engineering-patterns/interactive-explanations/)
(the algorithm-theater entry is his animated-word-cloud example,
generalized); the cognitive-debt framing is
[Margaret-Anne Storey's](https://margaretstorey.com/blog/2026/02/09/cognitive-debt/).*
