# Shared code craft — the portable rules for the code itself

These are the rules for **the diff an agent produces** once the lifecycle has
decided what to build. The lifecycle rules — specs, slices, tests, review,
merge — live in `shared-invariants.md`; this file is about the code and the
prose inside a change. Like the invariants, it is written to be copied
**verbatim** into another repository: it names no product, no package, no
command, and no vendor. Where a rule needs stack knowledge (where the layers
are, what the formatter already enforces), the binding version lives in
`local-engineering.md`.

Load this before writing or reviewing code — it is the standard the review's
standards axis holds a diff to, so writing against it and reviewing against it
are the same reading.

## 1. The smallest diff that delivers the behavior

Touch the fewest lines that deliver the stated change. Never modify code
unrelated to it: an improvement spotted nearby is a candidate for its own
structure-only change (shared invariant §10), never a passenger. The diff is
the unit of review — every extra changed line taxes the reviewer, widens the
blast radius of a revert, and buries the one change that needed reading.

## 2. Write short

Everything intended for a human — comments, commit messages, review text,
reports, replies — uses as few words as it takes. No superlatives, no praise,
no throat-clearing, no restating what the reader can see. An agent's flattery
and filler cost a human's reading time and buy nothing; a direct statement of
fact or finding is the respectful form.

## 3. Name the magic

A literal with meaning — a threshold, a mode string, a retry count — becomes a
named constant or enumeration at first use, not after the third copy. The name
is where the meaning lives; a bare literal makes every reader re-derive it, and
drifts silently the first time one copy changes without the others.

## 4. Keep the control flow flat

Handle the failing and trivial cases first and return (or skip) early, so the
happy path reads straight down at low indentation. Nesting is a debt every
later diff pays; a guard clause is its amortization.

## 5. Named states, not boolean parameters

A call site that reads as a bare `true, false` tells the reader nothing without
opening the definition. Two named states cost one declaration, read at every
call site, and survive the day the two states become three. The same goes for
return values: a boolean that encodes "which of two things happened" wants a
name for each thing.

## 6. Explicit blocks, always

In languages where a conditional or loop can govern a bare statement, write the
delimited block anyway. The one-line form invites the classic failure: a second
line added later, indented as if inside, executing outside. This rule costs two
characters and removes an entire bug class from review's attention.

## 7. Structure carries the what, comments carry the why

Group each logical step with blank lines around it, and give a step a short,
directive comment only where the intent cannot be read off the code — a
constraint, a non-obvious why, a warning to the next editor. Never narrate the
change itself ("added X", "now returns Y", "fixed the bug where…"): that is
the author talking to the reviewer, and it is noise the moment the change
lands. The diff already says what changed.

## 8. Respect the layering

Code talks to the layer directly below it, never through it. Reaching past an
intermediate layer converts one design decision into N scattered call sites,
and un-converting it later costs a migration. Where this project's layers
actually are is stack knowledge — `local-engineering.md` says, and a binding
decision record beats an inference from the current call graph.

## 9. Widening visibility is an interface change

Making a private thing public — exporting an internal, loosening an access
modifier, adding a getter for a hidden field — grows the module's interface,
which is exactly the surface a deep module keeps small. Doing it "just for a
test" or "just for this one call site" is how interfaces rot. It is a design
decision: surface it explicitly for review as its own line item, never as an
incidental hunk in an unrelated diff. A test that needs the widening is
usually testing through the wrong seam.

## 10. Diagrams are drawings, never character art

When structure needs a picture — a layering, a call flow, a before/after of a
refactor — draw a real vector diagram (SVG) in the HTML rendering of the report
or design document that argues for the change. **Never ASCII art**, in source
comments, reports, or documents: character drawings freeze layout into content,
break on the first edit, defeat diff review, and are invisible to accessibility
tooling. Prose stays prose; the picture is a picture, in the artifact whose job
is to be looked at. Which reports exist and how they render is process
knowledge — the practice documents that produce them say, and each names this
rule rather than restating it.

## 11. Never point a redirect at a file you cannot lose

A `>` truncates its destination the moment the shell parses it — before the
producing command runs, let alone succeeds. Point one at a file you need, and
a command that fails leaves zero bytes where the file was: data loss dressed
as a syntax convenience. Produce into scratch, check the producer's exit, and
only then move the bytes onto the real destination. The rule costs one
temporary file and removes silent truncation from the failure modes a review
has to imagine.

## 12. Declare the shell, then write for it

A snippet that never names its interpreter runs under whatever shell the
operator happens to live in, and an interactive shell rewrites what a strict
one passes through — an unbraced expansion with a colon after it can silently
become a history modifier and hand the next command an argument that does not
exist. Name the shell every snippet is for, and brace the expansion wherever
text follows it: `${REF}` ends the parse where `$REF` invites
reinterpretation. The gap between the shell that ran the tests and the shell
that runs the operator is a bug's favorite hiding place.

---

Most of these rules condense long-standing advice for human engineers, restated
for coding agents by Fabien Sanglard in his *agent.md* essay; they earned their
place here by naming mistakes agents demonstrably make. One deliberate reversal:
where that essay asks for drawings in ASCII, §10 inverts the medium — this
framework's reports render as HTML, and a medium that can carry a real vector
drawing makes character art a downgrade, not a convenience. §11 and §12 are
this project's own: each condenses a reproduced data-loss incident from its
history, not a line from the essay.
