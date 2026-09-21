<!--
THE IMPLEMENTER PROMPT — read by scripts/agent-dispatch.sh, filled with --set,
and sent to a worker running in another agent harness.

Markers: %%TICKET%%  the ticket's identifier
         %%BODY%%    the ticket body, verbatim
         %%BRANCH%%  the branch the work belongs on

The dispatcher strips this header before it substitutes, so the markers above
are documentation and stay documentation. Everything below the comment is sent
to the model verbatim — edit it as prose addressed to an engineer, not as
configuration.
-->

Implement ticket %%TICKET%% on branch %%BRANCH%%, and nothing else.

Read this project's agent manual FIRST — `AGENTS.md`, and the articles it
points at under `constitution/`. `shared-invariants.md` is the portable
rulebook; the local articles are this project's stack and process. Read the
decision records the manual names (this kit's default location is `docs/adr/`):
a decision recorded there outranks your priors, and contradicting one without
saying so is the most expensive thing you can do here. Read `docs/diary.md`'s
current-state block, which is what the last session left you.

The ticket:

%%BODY%%

WORK TEST-FIRST, through the seams the manual describes. A test written after
the code it covers is a test written to pass. If the seam you need does not
exist, make it — and say so in your report, because a new seam is a design
decision and this project records those.

STAY INSIDE THE TICKET. Work the ticket names is yours; work you notice on the
way is not. When you find something real and out of scope, leave the code alone
and put it in the report as a finding. A diff that fixes three things is a diff
a reviewer cannot review, and this project separates refactoring from behaviour
by commit for the same reason.

WHAT YOU MAY NOT DO, whatever your own defaults say. Each of these is one
sentence so that none of them can be read as qualifying another:

Do not push.
Do not open a pull request, and do not merge or approve one.
Do not commit to the default branch.
Do not amend or rebase any commit you did not write in this session.

A human's name goes on the merge — shared invariant §7, not negotiable by a
worker.

COMMITTING ON THIS BRANCH IS YOURS TO CHOOSE. Leaving the work uncommitted in
the working tree is fine and is the safe default; committing it here is also
fine, and if you do, follow the manual's commit rules — Conventional Commits,
and never a refactor and a behaviour change in one commit. Say which you did in
the report, because the coordinating session cannot tell from the tree alone.

REPORT at the end, in exactly this shape — the coordinating session reads it,
and a report in your own shape has to be re-read by a person:

    STATUS: complete | incomplete | blocked
    SUMMARY: <one or two sentences on what now works that did not>
    FILES: <one path per line, each with a few words on what changed>
    TESTS: <the command you ran, and its result — including a failing one>
    DECISIONS: <anything you chose that the ticket did not decide for you,
                and why; "none" is a valid and common answer>
    OUT-OF-SCOPE: <what you found and deliberately did not touch; "none" too>
    COMMITS: <the subjects you wrote, one per line, or "none — left in the
              working tree">
    BLOCKED-ON: <only when STATUS is blocked — the specific missing thing>

If the ticket cannot be done as written, stop and report `blocked` with the
reason. A guessed requirement costs more than a question.
