# The housekeeping checklist — each item in full

`/housekeeping` runs these in order. For every item: what to look at, what
counts as a finding, where the finding goes. A finding's entry in the report
carries the item number, the evidence (a path, a count, a diff), and the route.

## 1. The agent files

*Source: Addy Osmani, "Audit your Agent files" (2026); shared invariant §11;
the Agent Skills specification.*

- **The root manual's size.** Count its lines and compare with the count the
  last pass recorded in its stamp note (a first pass records the baseline).
  Growth is a finding to explain, not a failure: the always-loaded root is a budget every request pays (shared
  invariant §11). The reference point Osmani names is two hundred lines; a
  root well past it has elaboration that belongs in an article read on demand.
- **Rows whose target moved.** Every quick-reference row resolves — the gate
  holds that — but a row can point at a thing that still exists and no longer
  does what the row says. Read each row against its target's first paragraph.
- **Counts in prose.** Every number a standing instruction states about the
  repo — how many rules, how many skills, how many advisories — checked
  against the thing counted. A drifted count is the commonest rot there is.
- **Articles and skills nothing invokes.** For each skill, the last commit
  that touched it and any evidence of a run since the last pass (a PR body,
  a diary entry, a report path). A skill unused for two windows is a deletion
  candidate: propose removing it and running its task with the raw agent harness
  to see what is lost. Copying a skill in and keeping it are separate
  decisions.
- **Skill hygiene.** Frontmatter limited to the specification's fields;
  description under the specification's 1024 characters and leading with the
  use case; the body under
  five hundred lines; supporting files one level deep; no hard-coded date,
  version or model name; the description still true of the body.
- **Memory.** Whatever the agent harness keeps outside the repo — preferences,
  auto-memory — reviewed separately from the project files, because it holds
  stale preferences longest.

Route: candidate tickets, one per drift; deletion candidates as their own
tickets, labelled as proposals.

## 2. The glossary against the code

*Source: the glossary's own header rules; the context map's both-sides rule.*

- A term defined and never used in code, tests or the manual layer.
- A name that recurs in code with no glossary term, or with two spellings.
- A banned word appearing anywhere the glossary governs.
- A context-map edge declared from one side only, or declared with two
  different relationships.

Route: candidate tickets. A one-sided edge is a question for the brief's
owner before it is a ticket.

## 3. The decision index

*Source: `docs/adr/INDEX.md`'s conventions.*

- Every file under the records directory has an index row, and every row a
  file.
- Statuses are current: a record marked Proposed for two windows is a
  decision nobody made.
- Supersession is closed both ways: a record that says "superseded by" has a
  successor that says "supersedes".
- Decisions recorded in the diary but never promoted, where the diary entry
  says it should be.

Route: candidate tickets.

## 4. The measurement

*Source: shared invariant §9.*

- Run the command the engineering article's **Mutation decision** line names,
  on the pure, cheap tier. Record the score beside the last pass's. With no
  stamped article, read the repo's own suites and record that nothing is
  measured — a finding in its own right once there is a layer to measure.
- A score that fell is a finding about the tests that stopped enforcing.
- A decision line reading `none — <reason>` is re-read against the codebase
  as it is now: a reason that was true at one file and one script may not be
  true at a domain layer.

Route: a fallen score is a candidate ticket per surviving-mutant cluster; a
stale `none` is a ticket to make the decision again.

## 5. The worktrees

*Source: the root manual's first hard rule.*

- First compare the diary's Active worktrees row with `git worktree list`;
  a worktree on disk with no row, or a row with no worktree, is a finding —
  recorded before anything is pruned, or the pruning erases the evidence.
- Then run `/worktree-cleanup`.
- **Dispatch scratch.** A dispatch that died before its trap — killed, over a
  budget, on a host out of tasks — leaves its dispatch scratch behind: a
  directory named `agent-dispatch.*` under the temp location (`$TMPDIR`, else
  `/tmp`). The dispatcher sweeps the ones past the sweep age
  (`AGENT_DISPATCH_SWEEP_DAYS` in `scripts/agents.config.sh`) on its next run
  and says how many went; this pass lists each `agent-dispatch.*` directory
  by name and age — `ls -ld` on the temp location shows both — stale and
  fresh alike, and records the count beside the last pass's. The listing is
  the evidence: a name with an age past the sweep age is a dispatch that died
  and that no later dispatch has swept. A count that grows is dispatches
  dying before their trap — a finding about what kills them, not about the
  scratch.

Route: the pruning is the one action this pass delegates, and it is
`/worktree-cleanup`'s to perform on what is already merged; on a repo with no
worktrees the item reports "nothing to prune". The row mismatch is a finding
for the report, not an edit: the stamp is this pass's only write.

## 6. The diary's Current state

*Source: the diary's own update protocol.*

- The last-commit line, where the diary carries one, against `git log -1`.
- The phase line against what has shipped since.
- Open questions: any resolved elsewhere without being marked; any older than
  two windows with no owner.

Route: findings for the report, each a candidate ticket. The Current state
block is edited in place by design, but not by this pass — its only write is
the stamp.

## 7. The red-flag scan

*Source: John Ousterhout, "A Philosophy of Software Design", the red-flags
summary; the complexity definition in chapter 2.*

Spawn a read-only exploration in fresh context at the planner tier. It walks
the code weighted by the hot spots of a stretch of history, and reports each
red flag it meets with the file, the flag, and the cost in complexity terms
(change amplification, cognitive load, unknown unknowns):

- **Shallow module** — interface nearly as complex as the implementation.
- **Information leakage** — one design decision known in two places.
- **Temporal decomposition** — structure follows the order of operations
  rather than the information hidden.
- **Overexposure** — the common case forces callers to learn the rare one.
- **Pass-through method** — does nothing but call another with the same
  signature.
- **Repetition** — the same code, so the same knowledge, in several places.
- **Special-general mixture** — special-purpose code tangled with the general
  mechanism.
- **Conjoined methods** — two methods that cannot be understood apart.
- **Comment repeats code**, **implementation documentation contaminates
  interface**, **vague name**, **hard to pick name**, **hard to describe**,
  **nonobvious code** — the naming and comment flags, reported together.

Route: decided by the pass, not the scan, per `SKILL.md`'s Routing section —
`/improve-codebase-architecture` for one module with one flag, `/design-brief`
for a flag across a subsystem or traced to the recorded style, `/to-tickets`
for the rest.

## 8. The cadence

*Source: the gate config's own comment on `housekeepingDue.windowDays`.*

- If every pass finds nothing, the window is too short for this repo's pace;
  if every pass finds a drift that shipped in a release, it is too long.
  Propose the change as a candidate ticket; the window is policy, and policy
  is decided out loud.

## The stamp

The row's exact shape and clock are in the procedure's step 6 in `SKILL.md`;
one local commit, the row and nothing else.
