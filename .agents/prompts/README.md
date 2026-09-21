# `.agents/prompts/` — what a dispatched worker is told

A worker dispatched by `scripts/agent-dispatch.sh` runs in **another agent
harness**, in a fresh process, with none of the coordinating session's context.
What it knows is what these files say plus what its own agent harness loads
from this repository — which, because the kit ships `AGENTS.md` and its shims,
is the constitution.

These are **one file per task kind, never one per provider.** That rule is
`templates/workflows/ai-review-prompt.md`'s, and its reasoning transfers whole:
asking two vendors different questions and then comparing their answers
measures the prompts rather than the models, and two files that must stay
byte-identical are two files that eventually are not. A file cannot drift from
itself.

Markers are `%%NAME%%`, filled by the reading step — here,
`scripts/agent-dispatch.sh --set NAME=VALUE`. They are deliberately not any
agent harness's own expression syntax: an expression inside a data file is
never expanded, because it is evaluated by whatever reads the file.

Each file opens with an editor header in an HTML comment. **The dispatcher
strips it** before substituting, which is why the header can document its own
markers by writing them.

## What is deliberately NOT in these files

- **The rules.** `AGENTS.md` is the manual, the worker's agent harness loads
  it, and restating any of it here would create a second copy to keep in sync.
- **A model id, or an agent harness.** Those live in `scripts/agents.config.sh`.
- **Anything the coordinating session knows and the repository does not.** A
  worker that needs a fact the repo cannot state is a worker being asked to
  guess; put the fact in the ticket or the diary first.

## Editing them

They are yours from the moment bootstrap installs them — nothing here is shared
layer, and no update overwrites them. The one thing worth preserving if you
rewrite them wholesale is the **output contract** each ends with: the
coordinating session reads that output, and a worker that answers in its own
shape is a worker whose answer has to be re-read by a human every time.
