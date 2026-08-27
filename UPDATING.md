# Updating from a kit release

Your project took a copy of the kit when it was bootstrapped. **Two different
things came with it, and they update by two different rules** — because they
are two different kinds of thing:

| | What it covers | The right question at update time |
| --- | --- | --- |
| **Part 1** — steps 0–7 below | the files listed under `files:` in `VERSION` — the **shared layer** | *Is my copy byte-identical to the release?* |
| **Part 2** — steps 8–10 | skills, the manual and its articles, templates, config files, adapters | *What did the kit change, and did I change the same thing?* |

Part 1's files are a **copy**, so a byte comparison answers the question
completely. Part 2's files are **not** a copy: bootstrap stamped or installed
them and they became yours, and editing them is the intended workflow. A byte
comparison there answers the wrong question — it flags every local edit you were
invited to make, and following it would tell you to overwrite your own work.

**Both halves are one update.** Part 1 on its own is an *inert half-update*, and
the 0.4.0 wave is the illustration: `scripts/agents.lib.sh` (the capability-tier
resolver) joined the shared layer, so Part 1 delivers it — while the config it
reads, the skills that call it, and the manual section that defines its
vocabulary are all Part 2. Take Part 1 only and you land a resolver with no
mapping and no callers.

It is a **manual, reviewable update**, not a dependency bump — deliberately. The
shared layer is prose that every agent session loads; a silent upgrade of the
rules an agent works under is exactly the kind of change that should require a
human to read the diff.

> This file is itself shared layer. Do not edit it locally — an edited recipe
> drifts from the kit's actual layout and then tells you to do the wrong thing.
> Local notes go in a local article.

---

## Part 1 — what the shared layer is

The files listed under `files:` in `VERSION`, and nothing else.

They are copied **verbatim** from the kit. They name no product, no command, and
no vendor, which is exactly what makes them copyable at all. Everything else in
your repo — `AGENTS.md` and its shims, `README.md`, `docs/`, your skills, your
adapters — was stamped from a template and became **yours** the moment bootstrap
wrote it. Those are never *overwritten* for you; carrying a release's changes
into them is a decision you make, file by file, and that is Part 2.

`VERSION` records which release of the layer you are on:

```sh
sed -n 's/^shared-layer:[[:space:]]*//p' VERSION
```

`VERSION` is itself copied wholesale during an update (step 5). It carries no
project-specific content — only which release you are on and what that release
covers — so there is nothing in it to merge.

**A local exception to a shared rule never gets edited into the shared file.**
It goes in a local article, and the shared copy stays byte-identical. That rule
exists precisely so that this update stays a copy instead of an archaeology
exercise.

---

## Before you start

- A clean working tree (`git status` empty). Step 5 overwrites files in place.
- You are on a branch, not `main` — this lands as a reviewed PR like anything
  else. Shared invariant §7: an agent may take it to one click away and stops.
- **Every block below is POSIX `sh`, and `sh` is what you should run it in**
  (`sh` for a whole block, `sh -c '…'` for one line). It is also written to be
  safe in `bash` and `zsh`, because the shell you paste into is your login
  shell and on macOS that is `zsh` — but a shell that is neither of those three
  is not something this recipe has been run in.
- **After step 5, re-read this file from disk before you continue.** It is
  itself shared layer, so step 5 replaces the copy you are reading with the one
  that ships with the release you are adopting — and a release that changed its
  own update recipe is exactly the release whose recipe change you need. Step 5
  prints a `NOTE` when it happens, but that note lives in the *new* recipe, so
  the consumer who most needs it is following an old copy that never had it.
  This line is here to be the one thing every past copy of this file could have
  carried: **do not finish an update on the recipe you started it with.**

## Step 0 — point at the kit

```sh
KIT_URL=https://github.com/agranado2k/agentic-sdlc.git
WORK=$(mktemp -d)

git clone --bare --quiet "$KIT_URL" "$WORK/kit.git"
kit() { git --git-dir="$WORK/kit.git" "$@"; }
```

A bare clone: you are only ever *reading* out of it, and a second working tree
on disk is one more thing to get out of sync.

One more helper, and it is the one that keeps this recipe from destroying your
work. Part 2 repeatedly **takes** a file — writes the release's copy over one of
yours — and the obvious spelling, `kit show "$REF:$path" >"$mine"`, is unsafe:
the shell opens and **truncates `$mine` before `kit` is even started**, so a path
that is absent at that ref leaves you with zero bytes and a `fatal:` on stderr.
Absent is not exotic — a skill the kit renamed, an article you never stamped, a
config the kit ships only as a `.template`. Fetch first, write second:

```sh
kit_take() {                       # kit_take <ref> <path in the kit> <your file>
	kit show "${1}:$2" >"$WORK/take.$$" || { rm -f "$WORK/take.$$"; return 1; }
	cat "$WORK/take.$$" >"$3" && rm -f "$WORK/take.$$"
}
```

`cat >` rather than `mv` on the last line deliberately: it still truncates, but
only once the bytes are in hand, and it leaves your file's existing mode alone
(step 5 explains why a mode matters and why `>` cannot carry one). A take that
finds nothing returns non-zero and writes nothing, so `kit_take … || echo "…"`
is a verdict you can print rather than a file you have to restore from git.

Now pick the two points you are comparing.

```sh
FROM_REF="v$(sed -n 's/^shared-layer:[[:space:]]*//p' VERSION | head -1)"   # what you have

kit tag --list        # the releases on offer

TO_REF=               # ← what you want: fill it in from the list above

# Two guards, because what they catch is SILENT. An unset TO_REF, or one equal
# to FROM_REF, makes every step below succeed on a no-op: clean, all verbatim,
# gate green, nothing adopted. This recipe cannot ship a working default —
# whatever release number were written here would be the wrong one by the time
# you read it.
[ -n "$TO_REF" ] ||
	{ echo "TO_REF is unset — pick a release from the list above" >&2; false; }
[ "$FROM_REF" != "$TO_REF" ] ||
	{ echo "FROM_REF = TO_REF = $FROM_REF — you are already on it; there is nothing to update" >&2; false; }
```

> **Release refs.** Releases are the `v`-prefixed tags — `kit tag --list` above
> is the offer, and the kit holds itself to tagging every bump. Any ref the
> clone can resolve still works for an experiment, but an update you record in
> `VERSION` should come from a tag: an untagged ref is a point in someone's
> history, not a release.

### If your steps are separate processes

`$WORK`, the `kit()` function and both refs are shell state created here that
**every later step needs**, all the way through step 10. One terminal session
carries them for free. An agent running one command per tool call, a CI job with
a step per stage, or a human resuming tomorrow does not — and each of those
arrives at step 1 with `kit: command not found` or an empty `$WORK`.

Write the state down rather than carrying it. Run step 0's clone this way — with
a fixed `$WORK` rather than a temp one, because a path you cannot name is a path
the next process cannot find. User-scoped and mode 700, because a fixed name
under a shared `/tmp` is otherwise a name somebody else can claim first and a
directory somebody else can read:

```sh
WORK="${TMPDIR:-/tmp}/kit-update-$(id -u)"   # not mktemp -d: you must name it twice
mkdir -p -m 700 "$WORK"
git clone --bare --quiet "$KIT_URL" "$WORK/kit.git"
```

Then — **still in this same process** — pick `FROM_REF` and `TO_REF` exactly as
above, and only after that write the state down. An `env.sh` written before the
refs are picked persists empty refs, and every later step then succeeds on the
silent no-op the two guards above exist to catch:

```sh
cat >"$WORK/env.sh" <<EOF
WORK=$WORK
FROM_REF=$FROM_REF
TO_REF=$TO_REF
EOF

# The two functions go in with a QUOTED heredoc, so their `$` survive as written
# rather than being expanded now against this shell's empty variables.
cat >>"$WORK/env.sh" <<'EOF'
kit() { git --git-dir="$WORK/kit.git" "$@"; }
kit_take() {
	kit show "${1}:$2" >"$WORK/take.$$" || { rm -f "$WORK/take.$$"; return 1; }
	cat "$WORK/take.$$" >"$3" && rm -f "$WORK/take.$$"
}
EOF
```

Then start every later step with `. "${TMPDIR:-/tmp}/kit-update-$(id -u)/env.sh"`,
and delete the directory at the end of step 10 as usual. The refs go in the file
too: `FROM_REF` must **not** be re-derived from `VERSION` after step 5 (see step
8), and a fresh process is exactly where somebody would re-derive it.

## Step 1 — read both manifests

The file **list** can change between releases, so read it at both ends rather
than assuming your local one is current.

```sh
manifest() {
	kit show "${1}:VERSION" | awk '
		/^files:/       { inlist = 1; next }
		!inlist         { next }
		/^[ \t]*#/      { next }
		/^[ \t]*$/      { next }
		/^[ \t]+[^ \t]/ { sub(/^[ \t]+/, ""); sub(/[ \t]+$/, ""); print; next }
		                { inlist = 0 }
	'
}

manifest "$FROM_REF" | sort >"$WORK/from.list"
manifest "$TO_REF" | sort >"$WORK/to.list"

comm -13 "$WORK/from.list" "$WORK/to.list"   # files JOINING the shared layer
comm -23 "$WORK/from.list" "$WORK/to.list"   # files LEAVING it
```

That awk is the same parser `scripts/check.sh` uses. Two parsers for one file
format is two chances to disagree about what your own manifest says.

## Step 2 — read the upstream delta

What the **kit** changed between the two releases. This is what you are being
asked to adopt.

```sh
kit diff --stat "$FROM_REF" "$TO_REF" -- $(sort -u "$WORK/from.list" "$WORK/to.list")

# then read the ones that moved, in full — this is the part a human must read
kit diff "$FROM_REF" "$TO_REF" -- constitution/shared-invariants.md
```

Read it as rules, not as text. "§9 now requires X" is a change to how every
future session in this repo behaves.

## Step 3 — measure your own drift

What **you** changed. This should print `clean` for every file. Anything else is
a local edit to a file that was not yours to edit, and it is the only thing that
can make this update hard.

```sh
while IFS= read -r f; do
	if [ ! -e "$f" ]; then
		echo "MISSING $f"
		continue
	fi
	if kit show "$FROM_REF:$f" | cmp -s - "$f"; then
		echo "clean   $f"
	else
		echo "DRIFT   $f"
		kit show "$FROM_REF:$f" | diff -u - "$f" | sed 's/^/        /'
	fi
done <"$WORK/from.list"
```

**If you have drift**, stop and resolve it *before* step 5, not during:

1. Read what you changed and why. It is almost always a local exception someone
   needed and wrote in the nearest available place.
2. Move it to a local article — `AGENTS.md`'s local-rules section, or a
   `constitution/local-*.md` — where it belongs and where it survives updates.
3. Restore the shared file to its `FROM_REF` content
   (`kit_take "$FROM_REF" "$f" "$f"`), confirm step 3 is clean, and commit that
   as its **own** change. Untangling drift and adopting a new release in one
   commit makes both unreviewable (shared invariant §10).
4. If the exception is genuinely universal rather than local, it is a kit issue,
   not a local edit. Open one.

## Step 4 — decide

You now have three facts: what upstream changed, that your copy is unmodified,
and which files join or leave the layer. Decide, per file, whether you are taking
it. The default is **all of it** — a partial take is possible (step 7) but leaves
you on no release at all.

## Step 5 — apply

```sh
# every file in the TARGET manifest, taken verbatim — bytes AND mode
# shellcheck disable=SC2046
kit archive "$TO_REF" -- $(cat "$WORK/to.list") | tar -x
sed 's/^/  updated /' "$WORK/to.list"

# anything that LEFT the shared layer is no longer kit-owned. Deleting is the
# usual answer; keeping it means it is now an ordinary file of yours.
comm -23 "$WORK/from.list" "$WORK/to.list" | while IFS= read -r f; do
	git rm -q --ignore-unmatch -- "$f" 2>/dev/null || rm -f "$f"
	echo "  removed $f (left the shared layer at $TO_REF)"
done

# the manifest itself, wholesale — version marker and file list together
kit_take "$TO_REF" VERSION VERSION

# THIS FILE is shared layer, so the extract above just replaced it.
if ! kit diff --quiet "$FROM_REF" "$TO_REF" -- UPDATING.md; then
	echo "  NOTE  UPDATING.md changed in $TO_REF — RE-READ IT before continuing"
fi
```

**If that last line printed, stop and re-read this file from disk.** You opened
the recipe that shipped with `$FROM_REF`; step 5 has just overwritten it with
`$TO_REF`'s, and the copy in front of you is the old one. A release that changed
its own update recipe is precisely a release whose recipe change you need — 0.4.0
is the worked example: it is the release that added Part 2, and a consumer
following 0.3.0's copy reaches the end of step 6 and stops, because in that copy
step 6 *was* the end.

**`kit archive | tar -x`, not `kit show >`.** A `>` redirect writes bytes and
nothing else: the **mode bit is lost**, so a shared file that is `100755` in the
kit lands `100644` in your repo and fails the first time anything runs it. Git
carries exactly one mode bit and `git archive` carries it across; a redirect
cannot. It only bites files *joining* the layer — a file you already had keeps
the mode bootstrap gave it — which is precisely why it is easy to miss. (`tar`
creates the intermediate directories, so there is no `mkdir -p` to do.)

`kit_take` does not change that, and is not a substitute for it: it writes bytes
too, and deliberately leaves the destination's mode alone. It is for **Part 2**,
where every file is one you already have and its mode is already right. `VERSION`
uses it above only because a bad `$TO_REF` should not be able to empty your
version marker — the one file in this step that is not in the manifest and so is
not re-checked by step 6.

## Step 6 — verify the verbatim claim, then the gate

The version marker is only worth something if it is checkable. This is the check:

```sh
while IFS= read -r f; do
	want=$(kit ls-tree "$TO_REF" -- "$f" | awk '{print $1}')
	case "$want" in
	100755) wx=yes ;;
	*) wx=no ;;
	esac
	if [ -x "$f" ]; then hx=yes; else hx=no; fi

	if ! kit show "$TO_REF:$f" | cmp -s - "$f"; then
		echo "DRIFT     $f"
	elif [ "$wx" != "$hx" ]; then
		echo "MODE      $f (kit has $want)"
	else
		echo "verbatim  $f"
	fi
done <"$WORK/to.list"

sh scripts/check.sh
```

The mode leg is not decoration. A content-only `cmp` reports `verbatim` for a
file whose executable bit is wrong — a green check over the exact failure step 5
used to produce. Git records one mode bit and no more, so that is all this
compares; the rest of the permissions come from your umask and are yours.

Every line `verbatim`, and the gate green — with one designed exception. **When
a constitution article joins the layer** (0.5.0's `shared-code-craft.md` is the
first), step 6 ends **red** with `article-unreferenced`: the article is shared
layer, but the *pointer* to it lives in your root manual, which is yours. That
red is the recipe working — it is what forces the shared half and the manual
half of the update to land together. Add one pointer line to the manual's
article layer, re-run the gate, and only then commit. One caveat: that rule
lives in the node harness — the reduced no-node fallback cannot check article
reachability (its NOTICE says exactly that), so without the runtime this red
never fires and remembering the pointer is on you. Then:

```sh
git add -A
git commit -m "chore: update shared layer ${FROM_REF#v} -> ${TO_REF#v}"

echo "Part 1 complete — shared layer at $TO_REF. The update is not done: go to step 8."
```

Note it in `docs/diary.md` — a change to the rules every session loads is a
diary entry by the update protocol ("decision reversed or vendor changed").

**Do not stop here, and do not read the green gate as "done".** The gate is
green because the shared layer is intact, which is all it checks. It cannot see
that the config the new shared code reads, the skills that call it and the manual
section that names its vocabulary have not arrived — those are Part 2, steps
8–10, and the only honest end of an update is the end of step 10. `$WORK` stays
where it is; step 8 reuses it.

---

## Step 7 — taking only part of a release

Sometimes one file's change needs a discussion you are not having today. Take
the rest:

```sh
kit archive "$TO_REF" -- constitution/shared-invariants.md | tar -x
```

Same tool as step 5, for the same reason: one file taken with a `>` redirect is
one file whose mode you may have just changed.

…and then **do not bump `shared-layer:`**. A partial take is not the release.
Leave the marker at `FROM_REF`, and record what you deferred and why — in the
diary, or as an issue. The next update then starts from a version you are
genuinely on.

The check in step 6 is what makes this honest: it is the difference between "we
are on 0.3.0" and "we believe we are on 0.3.0". Run it any time, not only during
an update.

## When a file joins the shared layer

Step 5 writes it for you. Three things to check afterwards:

- **You may already have a file at that path.** Step 5 overwrote it. If it had
  local content, recover it from git and move that content to a local article —
  the path is kit-owned from this release on.
- **Its MODE has to arrive with it.** A joining file is the only case where the
  mode can be wrong: a file you already had keeps the one bootstrap gave it,
  while a new one gets whatever step 5 wrote. That is why step 5 uses
  `kit archive | tar -x` and why step 6 compares the executable bit — a shared
  *script* that arrives non-executable fails the first time something runs it,
  and a byte comparison calls it verbatim.
- **The gate now requires it.** `scripts/check.sh` fails if a file named in
  `VERSION` is missing, so deleting it later fails your push rather than silently
  degrading.
- **A constitution article additionally needs a pointer.** The gate refuses an
  article the root manual never references (`article-unreferenced`), so step 6
  stays red until one line joins `AGENTS.md`'s article layer. Deliberate: an
  article nothing points at binds nobody, and would drift unnoticed. (Node
  engine only — the reduced fallback cannot check reachability, and says so.)

## When a shared file's BEHAVIOUR changes

Most releases move prose. Some move **code**, and step 5 replaces it without
asking, because that is what "verbatim copy" means. The question a code change
leaves you with is not *did I get the bytes* — step 6 answers that — but **does
anything I own need to change to match**.

Read the release's `VERSION` comment block first: it says what changed and, for
each change, which half of the wave it sits in. Then ask, in this order:

- **Did the shared code's contract NARROW?** A new required argument, a removed
  variable, a stricter check. Your own callers — scripts, hooks, anything in a
  local article that quotes a command — have to be found and fixed, and Part 1
  alone will have already broken them. Nothing but the release notes will tell
  you; the gate only checks the layer is intact.
- **Did it WIDEN?** A new optional argument, a new variable it will read if you
  set one. Nothing of yours breaks, and nothing of yours has to change — but the
  feature is inert until Part 2 brings across the skills that use it and, in
  most cases, until you add something to a config file of your own (9d).

**0.7.0 is a widening, and the cleanest example of one yet.**
`scripts/agents.lib.sh` gained an optional second argument, the task **domain**:

```sh
sh scripts/agents.lib.sh implementer            # exactly as before
sh scripts/agents.lib.sh implementer content    # new: prefers
                                                # AGENT_TIER_IMPLEMENTER_CONTENT
```

Called with one argument it behaves as it did at 0.6.0, so a consumer on 0.6.0
runs Part 1, gets the new resolver, and **nothing they own needs to change at
all**. What the release is *for* is Part 2 and one edit of your own:

- **9d, your `scripts/agents.config.sh`** — optional, and the only place a
  mapping can live. Add `AGENT_TIER_<TIER>_<DOMAIN>` variables for the
  distinctions your repo actually has (`AGENT_TIER_IMPLEMENTER_CONTENT` is the
  usual first one) and leave the rest alone: an unmapped domain falls back to
  the plain tier, silently and correctly. The kit's copy gained only a comment
  block describing the convention — the key-set diff in 9d will show no new
  keys, because the kit ships every mapping empty and always will. Take the
  comment across by hand if you want the documentation next to the data;
  skipping it costs you nothing but the documentation.
- **9a, the skills** — `/to-tickets` learned to stamp an optional `Domain:` line
  when the medium of the work would change which model you would pick, and
  `/implement` learned to pass that line through as the second argument. Without
  these two hunks the resolver's new axis is reachable only by hand.
- **9b, the manual** — the "Capability tiers" section gained a paragraph on the
  domain axis and the fact that its vocabulary is open and local, unlike the
  four closed tier names.
- **9e, the adapters** — if you kept the tree, `adapters/claude-code/README.md`
  works a domain-qualified spawn through end to end.

Take Part 1 alone here and you are not broken, merely unchanged: the seam is
present and nothing reaches it. That is the same inert half-update this file
opens with, in its mildest form.

## When a shared file's path changes

Treat it as one leaving and one joining: it falls out of `from.list` and into
`to.list`, and step 5 handles both halves. Check the upstream diff for the
rename note so you know it is the same file, not a deletion plus an unrelated
addition.

---

## Worked example — Part 1

A real run, captured from `tests/docs-demo.sh` in the kit. The setup: a consumer
that bootstrapped at shared-layer **0.1.0** (whose layer was
`constitution/shared-invariants.md` alone), updating to **0.10.0** (by which point
the guards, the gate, the harness engine, the tier resolver, the code-craft
article and this file have all joined the layer). The consumer has one local edit to a shared file — the
drift case, because the clean case teaches nothing.

Refs are local paths here rather than tags, per the pre-1.0 note in step 0. Both
transcripts are captured under `LC_ALL=C`, so a reader who runs the recipe in
another locale may see the same lines sorted differently — `sort` and `comm`
order by the locale's collation, and only the paths move, never the verdicts.

```console
$ kit tag --list
v0.1.0
v0.10.0
$ echo "$FROM_REF -> $TO_REF"
v0.1.0 -> v0.10.0

$ comm -13 "$WORK/from.list" "$WORK/to.list"   # JOINING
UPDATING.md
constitution/shared-code-craft.md
scripts/agents.lib.sh
scripts/behavior-delta.sh
scripts/check.sh
scripts/docs-conformance/context.mjs
scripts/docs-conformance/index.mjs
scripts/docs-conformance/runner.mjs
scripts/docs-conformance/validators/claude-md-refs.mjs
scripts/guards.lib.sh
scripts/tdd-pairing-guard-ci.sh
scripts/tdd-pairing-guard.sh
$ comm -23 "$WORK/from.list" "$WORK/to.list"   # LEAVING
(none)

$ kit diff --stat "$FROM_REF" "$TO_REF" -- $(sort -u "$WORK/from.list" "$WORK/to.list")
 UPDATING.md                       | 1306 +++++++++++++++++++++++++++++++++++++
 constitution/shared-code-craft.md |  129 ++++
 constitution/shared-invariants.md |    8 +-
 3 files changed, 1442 insertions(+), 1 deletion(-)

$ kit diff "$FROM_REF" "$TO_REF" -- constitution/shared-invariants.md
diff --git a/constitution/shared-invariants.md b/constitution/shared-invariants.md
index 7661602..5c18e6a 100644
--- a/constitution/shared-invariants.md
+++ b/constitution/shared-invariants.md
@@ -96,3 +96,3 @@ A rule that is neither is a suggestion. Label it as one or delete it.
 
-## 9. Measure the ceiling
+## 9. Measure the ceiling, don't assume it
 
@@ -117,2 +117,8 @@ refactor first, on its own, with the suite green before and after.
 
+Per §8 this rule is checkable rather than merely asserted, because the claim is machine-
+visible: a commit whose declared type says "structure only" while its own diff touches a
+contract artifact has contradicted itself. Review tooling should surface those commits as
+a confirm item — the author either splits the commit or relabels it, and both outcomes are
+better than a reviewer discovering the mix by reading.
+
 ## 11. The context budget is a real budget

$ # step 3 — drift check
DRIFT   constitution/shared-invariants.md
        @@ -122,3 +122,5 @@
         push elaboration into articles read on demand; scope package-specific rules to the
         package. Duplicated guidance is not redundancy, it is drift waiting to happen — every
         rule has exactly one home, and everywhere else points at it.
        +
        +NOTE (local): §4 is waived for the QA phase in this repo.

$ # the exception moves to a local article; the shared file is restored
clean   constitution/shared-invariants.md

$ # step 5 — apply
  updated UPDATING.md
  updated constitution/shared-code-craft.md
  updated constitution/shared-invariants.md
  updated scripts/agents.lib.sh
  updated scripts/behavior-delta.sh
  updated scripts/check.sh
  updated scripts/docs-conformance/context.mjs
  updated scripts/docs-conformance/index.mjs
  updated scripts/docs-conformance/runner.mjs
  updated scripts/docs-conformance/validators/claude-md-refs.mjs
  updated scripts/guards.lib.sh
  updated scripts/tdd-pairing-guard-ci.sh
  updated scripts/tdd-pairing-guard.sh
  NOTE  UPDATING.md changed in v0.10.0 — RE-READ IT before continuing

$ # step 6 — verbatim check (bytes AND mode), then the gate
verbatim  UPDATING.md
verbatim  constitution/shared-code-craft.md
verbatim  constitution/shared-invariants.md
verbatim  scripts/agents.lib.sh
verbatim  scripts/behavior-delta.sh
verbatim  scripts/check.sh
verbatim  scripts/docs-conformance/context.mjs
verbatim  scripts/docs-conformance/index.mjs
verbatim  scripts/docs-conformance/runner.mjs
verbatim  scripts/docs-conformance/validators/claude-md-refs.mjs
verbatim  scripts/guards.lib.sh
verbatim  scripts/tdd-pairing-guard-ci.sh
verbatim  scripts/tdd-pairing-guard.sh
$ sh scripts/check.sh
FAIL  docs gate: violations found

FAIL  docs conformance: violations found

  [claude-md-refs] (1)
    x constitution/shared-code-craft.md [article-unreferenced] — is not referenced from AGENTS.md — no agent will ever be pointed at it
      -> Add a pointer to it in AGENTS.md's article layer, or delete the article — an unreachable standing instruction binds nobody and drifts unnoticed.

1 violation(s) across 1 validator(s).

Fix them, or see .githooks/pre-push for the logged bypass.

$ # RED, deliberately: the ARTICLE is shared layer, the POINTER to it is
$ # yours (the root manual — Part 2 territory). Add it and re-run.
$ sh scripts/check.sh
OK  docs gate: all checks passed (shared-layer 0.10.0, engine: harness)
$ sed -n 's/^shared-layer:[[:space:]]*//p' VERSION
0.10.0
Part 1 complete — shared layer at v0.10.0. The update is not done: go to step 8.
```

**Read the last two lines before the drift block.** `NOTE  UPDATING.md changed`
is step 5 telling this consumer that the recipe it is running is no longer the
recipe on disk — at 0.1.0 there was no `UPDATING.md` at all, and at 0.4.0 there
is one with a Part 2 in it. And the run does not end on the green gate; it ends
by naming step 8. A green gate here means "the shared layer is intact", which is
a smaller claim than "you are updated".

Read the drift block again. The consumer had written a local exception **into**
the shared rulebook. Step 3 found it in one command; the fix was to move those
two lines to `AGENTS.md` and restore the shared file to its 0.1.0 bytes, as its
own commit. Only then did step 5 run — and it is a plain overwrite, because
there was nothing left to merge.

Had the exception stayed where it was, step 5 would have silently destroyed it
and nobody would have known which paragraph used to be there.

The lesson is step 3. The update itself is one `git archive` extract over the
whole manifest; what makes it cheap or expensive is entirely whether anyone
edited a file that was not theirs to edit.

---

# Part 2 — the parts that are yours

Everything bootstrap stamped, installed or left behind is **yours**: the skills
under `.claude/skills/`, `AGENTS.md` and the `constitution/local-*.md` articles,
the workflows under `.github/workflows/`, the config files, `README.md`, `docs/`,
and `adapters/`.

"Yours" does not mean frozen. The kit keeps improving them, and a release's
actual *features* usually live here rather than in the shared layer — 0.4.0's
value is a Deliver phase in `/implement`, tier-aware planning in `/to-tickets`,
two new skills and a cross-provider review workflow, none of which is
manifest-listed. What "yours" means is that **nothing here is ever overwritten
without you looking at it**, and that there is no verbatim check at the end: the
docs gate is the check.

Do Part 2 *after* Part 1 and commit it separately (shared invariant §10). Part 1
is a mechanical overwrite anybody can re-derive; Part 2 is a series of
judgements, and a reviewer reading the two mixed together can check neither.

## Step 8 — list what changed outside the shared layer

Reuse the bare clone, the two refs, and the two manifests from steps 0 and 1.

```sh
kit diff --name-only "$FROM_REF" "$TO_REF" | sort >"$WORK/changed.all"
sort -u "$WORK/from.list" "$WORK/to.list" >"$WORK/shared.all"
comm -23 "$WORK/changed.all" "$WORK/shared.all" >"$WORK/changed.yours"

cat "$WORK/changed.yours"
```

Do **not** re-derive `FROM_REF` from `VERSION` here: step 5 already moved it to
the release you are adopting. Part 2 runs in the same session as Part 1, on the
same two refs.

**Two different kinds of line in there get skipped, for two different reasons,
and only the first kind is obvious.**

**Paths you do not have.** Bootstrap deletes the kit's own scaffolding (`tests/`,
`.github/workflows/kit-*.yml`, `EXCLUSIONS.md`, and `bootstrap.sh` itself) and
consumes `templates/docs/` into `docs/`. A path you do not have is not an update
— skip those lines. `VERSION` prints too, because it is not an entry in its own
manifest; step 5 already copied it.

**Paths you DO have, that are the kit's copy of a file you own.** The kit
self-hosts the constitution it ships, so it has its own `AGENTS.md`, its
`CLAUDE.md` / `GEMINI.md` shims, its `README.md`, its `docs/diary.md`, its
`docs/adr/*` and its `docs/domain-glossary.md` — and every one of those is a real
path in your repo too. "A path you do not have" does not dismiss them, so say it
plainly instead: **the kit's own manual and docs are never your base.** They are
one project's filled-in copy, exactly as yours is; two consumers of the kit are
not each other's upstream.

The trap is `AGENTS.md`, because it is the one where the mistake produces a
plausible-looking diff. Your manual's base is `constitution/AGENTS.md.template`
(9b), which is the file bootstrap stamped and the only kit file your manual
descends from. Diff against the kit's root `AGENTS.md` instead and you are
reading someone else's local rules — hard rule numbering, worktree conventions,
a capability-tier wrapper that exists in the kit and nowhere else — and every one
of them looks like a section you are missing. `README.md`, `docs/diary.md` and
`docs/adr/` are the same shape one notch less dangerous: 9c already says a kit
change under `templates/docs/`' descendants is something to read and borrow
from, never something to copy over the top. This is that rule, stated where the
line actually appears in front of you.

## Step 9 — take each category by its own rule

One rule per category, because the categories differ in what a local edit
*means*:

| Category | Paths | The rule |
| --- | --- | --- |
| **Skills** (9a) | `.claude/skills/*/` | three-way: kit's old → kit's new → yours. Take the delta unless you deliberately forked |
| **Manual & articles** (9b) | `AGENTS.md`, `constitution/local-*.md` | three-way against the `.template` they were stamped from; you are hunting for **sections** you do not have |
| **Templates** (9c) | `templates/workflows/*` → `.github/workflows/` | copy only what the release changed and you have not customized; a template you deleted stays deleted |
| **Config** (9d) | `scripts/*.config.sh`, `scripts/docs-conformance/config.mjs`, `.../local-vocabulary.mjs` | **never overwrite.** Ask about both refs, then diff the key sets (`.sh`) or read the diff (`.mjs`) — the new shared code may read a key you do not set |
| **Adapters** (9e) | `adapters/` | opt-in, whole-directory. Take a tree or leave it; never half of one |

### 9a. Skills — a three-way, not a copy

A skill is prose an agent loads, and adapting it to your repo is the intended
way to make the chain fit. So "is it byte-identical to the release?" is the
wrong question here; the right one is **"what did the kit change, and did I
change the same lines?"**

```sh
S=.claude/skills/implement/SKILL.md

kit diff "$FROM_REF" "$TO_REF" -- "$S"       # what the KIT changed
kit show "$FROM_REF:$S" | diff -u - "$S"     # what YOU changed since bootstrap
```

Four outcomes, and only one of them needs a human:

- **kit clean, you clean** — nothing to do.
- **kit changed, you clean** — take it: `kit_take "$TO_REF" "$S" "$S"`.
- **kit clean, you changed** — nothing to do. Your version stands.
- **both changed** — merge; do not pick a side:

  ```sh
  kit_take "$FROM_REF" "$S" "$WORK/base" || { echo "no $S at $FROM_REF"; false; }
  kit_take "$TO_REF" "$S" "$WORK/theirs" || { echo "no $S at $TO_REF"; false; }
  git merge-file "$S" "$WORK/base" "$WORK/theirs"
  ```

  `git merge-file` merges in place and exits non-zero after writing conflict
  markers where the two edits overlap. Read those; there is no verbatim check to
  fall back on, which is exactly why this category is not automatable.

  The two takes are guarded even though they only write scratch files, because
  `git merge-file` writes **`$S` itself**. Hand it an empty `theirs` — which is
  what a plain `kit show … >"$WORK/theirs"` leaves behind when the kit renamed
  the skill — and every line of your file reads as "deleted upstream", so the
  merge empties it. Guarding a temp file is guarding `$S`, one step removed.

**If you deliberately forked a skill, write the fork down** — one line in a
local article ("`/review-pr`'s Axis-2 section is ours; we replaced the
confirm-list format"). That single line is the whole difference between a fork
and drift, because the next update is run by somebody who was not there. It is
the same rule as Part 1's step 3, moved one category over: the exception lives
in a local article, not in the file the kit owns.

**A new skill is a directory copy, and it is not installed until the manual
points at it.**

```sh
kit diff --name-only --diff-filter=A "$FROM_REF" "$TO_REF" -- .claude/skills

kit archive "$TO_REF" .claude/skills/improve-codebase-architecture | tar -x
```

Then add its row to `AGENTS.md`'s quick reference **by hand**. That is not
bookkeeping. The docs gate resolves every `/command` in the manual layer to a
skill directory, so a row whose skill you did not copy fails your next push
(`skill-missing`) — and a skill with no row is a command nobody in this repo
will ever find.

**A removed skill** (`--diff-filter=D`) is the reverse: delete the directory and
the row in the same commit, and let the gate catch the half you forgot.

### 9b. The manual and the local articles — hunt for missing SECTIONS

`AGENTS.md` was stamped from `constitution/AGENTS.md.template`; each
`constitution/local-*.md` was stamped from its `.template` sibling. All of them
are yours, and bootstrap refuses to run twice, so a release's changes to those
templates reach you only if you carry them.

```sh
kit diff "$FROM_REF" "$TO_REF" -- constitution/
```

Read that diff for **new sections**, not new lines. When a release introduces a
*concept*, it introduces it here, and your stamped copy simply has no paragraph
about it. 0.3.0 → 0.4.0 adds a "Capability tiers" section to the manual template
and a matching block to the workflow article: skip them and your repo has skills
that speak four tier names and no file that says what they mean.

Copy the new sections across by hand, adapting the wording to your repo. Never
re-stamp a template over a manual you have been editing for six months.

**First check that there is a manual you have been editing.** That headline rule
assumes you stamped the article; plenty of repos never did. Bootstrap leaves
`constitution/local-*.md.template` in place with its marks intact, the manual
points at the `.template` path, and the gate accepts it — an unfilled article is
a legitimate state, not a broken one. For that state the right action is the
*opposite* of the headline: nothing of yours is in the file, so take the new one
whole.

```sh
A=constitution/local-workflow.md
[ -e "$A" ] || A="$A.template"     # never stamped — still the template
SRC=constitution/local-workflow.md.template

if kit show "${FROM_REF}:$SRC" | cmp -s - "$A"; then
	echo "UNSTAMPED $A — nothing of yours in it; take the new template whole"
	kit_take "$TO_REF" "$SRC" "$A"
else
	echo "YOURS     $A — hunt for new SECTIONS, as above"
fi
```

**Note the braces on `${FROM_REF}`, and keep them.** Every `$REF:` in this recipe
is followed by a `$` or by a brace, never by a bare letter, and that is not
style. `zsh` — macOS's default shell, and one an operator will paste this into —
applies **history modifiers** to `$var:x` *inside double quotes*: drop the braces
and the `:c` beginning `constitution/…` is taken as a modifier, so git is handed
`v0.10.0` followed by `onstitution/…`. It resolves nothing, so `kit show` prints
`fatal:` and nothing else — and the `cmp` above then compares your article
against **empty input** and answers `YOURS` for a file that is verbatim the
template. Silence in the wrong arm; the take you needed never runs. `:c` is not
the only one reachable (`:a :e :h :l :q :r :s :t :u :x` and `:g&` all are), which
is why the rule is "brace it", not "avoid the letter c".

The test is "is my copy byte-identical to the `.template` it came from", not
"does its name end in `.template`" — a stamped `.md` nobody has edited yet is the
same case and gets the same answer. Once you have edited it, this returns `YOURS`
by itself and never fires again.

**A section you carry may cite a tree you declined.** 0.4.0's "Capability tiers"
section — the one this release asks you to copy — ends by pointing at
`adapters/claude-code/README.md`, and `adapters` is a path root the docs gate
resolves. If you deleted `adapters/` at bootstrap (9e says that is a supported
answer), copying the section verbatim makes your next push red with
`path-missing`, and neither section warns you. That is the general rule rather
than a special case: **the manual layer is checked, so a paragraph you borrow has
to be true in *your* repo.** Drop the sentence, or re-point it at your own
harness note, as you copy.

### 9c. Templates — take what moved, keep what you removed

`templates/workflows/` is installed into `.github/workflows/` **once**, at
bootstrap, and bootstrap never overwrites a file that is already there (it prints
`kept …`). So a release's changes here reach you only by hand.

```sh
kit ls-tree --name-only "$TO_REF" templates/workflows/ | while IFS= read -r wf; do
	dest=".github/workflows/$(basename "$wf")"

	if [ ! -e "$dest" ]; then
		if kit cat-file -e "$FROM_REF:$wf" 2>/dev/null; then
			echo "DECLINED  $dest"        # you had it and removed it
		else
			echo "NEW       $dest"        # first appearance in this release
		fi
	elif kit diff --quiet "$FROM_REF" "$TO_REF" -- "$wf"; then
		echo "UNCHANGED $dest"                # the release did not touch it
	elif kit show "$FROM_REF:$wf" 2>/dev/null | cmp -s - "$dest"; then
		echo "UNTOUCHED $dest"                # yours is the old release's, verbatim
	else
		echo "YOURS     $dest"                # you customized it
	fi
done
```

- **`NEW`** and **`UNTOUCHED`** are both `kit_take "$TO_REF" "$wf" "$dest"` —
  and unlike step 5 there is no mode to carry, because workflow templates are
  plain 100644 files. `UNTOUCHED` is the one that needs the guarded take: the
  destination is a file you already have, and `$wf` came from a listing of
  `$TO_REF`, so the only way it is absent there is a race with a re-tag — rare,
  and it costs you a workflow.
- **`YOURS`** is a three-way merge, exactly as in 9a.
- **`UNCHANGED`** and **`DECLINED`** are *nothing to do*.

**`DECLINED` is the outcome that matters, and it is why this loop asks two
questions instead of one.** "The file is not there" cannot tell *you never had
this* from *you deliberately removed it* — and bootstrap installed every template
that existed at the release you bootstrapped from, so for those, absence is
always a decision. Folding two gates into one CI workflow and deleting the kit's
copy is a normal, supported thing to have done; a recipe that reads that as `NEW`
tells you to re-add a duplicate gate to every PR, and you will do it, because the
line said `NEW`.

If a release *changed* something you declined, the verdict is still `DECLINED` —
re-adopting it is a decision, not an update. Read `kit diff "$FROM_REF" "$TO_REF"
-- "$wf"` if you want to reconsider, and if you take it back, say so where the
decision was written down.

**A workflow can have a file it needs beside it.** 0.4.0's
`ai-review.example.yml` reads `.github/workflows/ai-review-prompt.md` at run
time; take one without the other and you have a workflow that fails on its first
run. Take a template together with its neighbours, and keep the `.example`
suffix until you have added a provider secret — it ships inert on purpose.

`templates/docs/` is a different case: bootstrap consumed it and deleted it. Its
descendants — `README.md`, `docs/diary.md`, `docs/adr/`, the PR template — are
ordinary files of yours now. A kit change there is something you may read and
borrow from; it is never something to copy over the top.

### 9d. Config files — never overwrite, and never guess which ref has them

**This is the category that breaks silently**, because both failure modes are
quiet. Overwrite the file and your provider and model choices vanish with no
error. Skip it and the release's new shared code reads a key you never set,
resolves it to empty, and carries on.

The config files are the ones `VERSION` names in its "everything NOT shared"
comment, and the list is deliberately reproduced here with what each one *is*,
because both facts change what you do with it:

| Config | In the kit it is | Compared by |
| --- | --- | --- |
| `scripts/guards.config.sh` | a file at that path | key sets (`NAME=`) |
| `scripts/agents.config.sh` | a file at that path, since 0.4.0 | key sets (`NAME=`) |
| `scripts/docs-conformance/config.mjs` | a file at that path | reading the diff |
| `scripts/docs-conformance/local-vocabulary.mjs` | **only a `.template`** | reading the diff of the `.template` |

The fourth row is not a footnote. It is why the first question below has to be
asked about *both* refs rather than one.

**Ask about BOTH refs before you write anything.** Two questions, three answers
— and the third one is the one that eats files:

```sh
C=scripts/agents.config.sh

if kit cat-file -e "${FROM_REF}:$C" 2>/dev/null; then
	echo "MERGE   $C existed at $FROM_REF — diff the keys, below"
elif kit cat-file -e "${TO_REF}:$C" 2>/dev/null; then
	echo "ADD     $C is new at $TO_REF — copy it whole"
	kit_take "$TO_REF" "$C" "$C"
else
	echo "STAMPED $C — the kit has no such path at either ref; see below"
fi
```

`MERGE` is the 0.4.0 → 0.10.0 case for this file, and `ADD` is the 0.3.0 → 0.10.0
one: `scripts/agents.config.sh` did **not** exist at 0.3.0 — it arrived with the
0.4.0 wave's tier resolver — so a 0.3.0 consumer copies the whole file and then
edits it. Nothing is at risk there, which is precisely why it is worth checking
rather than assuming: the same path is a destructive overwrite for a consumer who
*did* have it.

**`STAMPED` is not a rare third case — it is half the list above.**
`scripts/docs-conformance/local-vocabulary.mjs` is yours because bootstrap
*stamped* it from `local-vocabulary.mjs.template`, and the kit therefore has that
path at **neither** ref, in every release there has ever been. A branch that asks
only about `FROM_REF` reads that `no` as "then it is new upstream", prints
`ADD … copy it whole` — which was never true of this path — and runs a take that
cannot succeed. It is the same `.template`-versus-stamped asymmetry 9b handles
one category over, and 9d has to answer it the same way: **the file to compare
against is the `.template`**, and there is nothing at `$C` to take.

```sh
kit diff "$FROM_REF" "$TO_REF" -- "$C.template"   # what the kit changed in the SOURCE
```

Read that diff and carry across what applies, exactly as in 9b. Never re-stamp
the template over the file — the whole point of stamping is that the copy became
yours.

Note what `kit_take` bought in the `ADD` arm even so. The obvious spelling,
`kit show "$TO_REF:$C" >"$C"`, truncates `$C` before `kit` runs, so the moment
the two questions above are asked in the wrong order — or a release renames the
path — the consumer's config is zero bytes and the only copy is in git history.
Step 0 explains the shape; this is the branch where it was first paid for.

**For the MERGE case, never `kit show >` the file.** How you compare depends on
what shape the config is, and the four above are two different shapes:

**The `.sh` configs are `NAME=value` lines, so diff the key sets.**

```sh
keys() { sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1" | sort -u; }

kit_take "$TO_REF" "$C" "$WORK/config.new" || { echo "no $C at $TO_REF"; false; }
keys "$WORK/config.new" >"$WORK/keys.new"
keys "$C" >"$WORK/keys.mine"

# A key extractor that finds NOTHING has not found "no new keys" — it has failed
# to read the file, and the two `comm`s would then print nothing whatever the
# truth is. So they only run when there is something to compare.
if [ -s "$WORK/keys.new" ]; then
	comm -13 "$WORK/keys.mine" "$WORK/keys.new"   # keys the RELEASE expects, you lack
	comm -23 "$WORK/keys.mine" "$WORK/keys.new"   # keys only you have — yours, or removed upstream
else
	echo "keys(): no NAME= lines in $C — wrong tool for this file; read the diff" >&2
	false
fi
```

Add each missing key to your file **with your value**, and bring the kit's
comment block for it across so the next reader knows what it is for. An unset key
is not automatically a bug — `agents.config.sh` ships all four tiers empty and
unset is a documented working state — but it has to be a key you decided to leave
unset, not one you never saw.

**The `.mjs` configs are read, not extracted — and that is not a gap to fill
later.** `keys()` above understands shell assignments only, so pointing it at
`config.mjs` or `local-vocabulary.mjs` yields an empty set, and two empty sets
`comm` as "nothing missing" no matter what changed. The guard line above is what
turns that silence into a sentence. But **a smarter extractor would not fix
this**, because the changes that matter in these files are not new keys:

```sh
kit diff "$FROM_REF" "$TO_REF" -- scripts/docs-conformance/config.mjs
```

0.5.0 is the worked example, and it is the one this method missed in the field.
`constitution/shared-code-craft.md` joined the shared layer, and the consumer's
own `config.mjs` had to add that path to the **array under `portability.files`**
or the gate would never check the new article for vocabulary leaks. Every key in
that file was already present at both refs. A key-set diff reports `(nothing)`
and is telling the truth about keys while being useless about the release.

So: read the diff, with the same question 9b asks of the manual — *what does the
release now expect this file to say?* Then edit yours by hand. It is the smallest
of the five categories and the one where being told a false "nothing to do" costs
the most, because the thing it silently skips is a gate that stops checking.

Then re-read `scripts/agents.lib.sh` (or whatever shared code reads the config).
It is shared layer, so Part 1 already replaced it: what it reads *now* is the
authority on what your config has to provide.

### 9e. Adapters — opt-in, whole-directory

`adapters/` is reference material. Nothing in it runs, nothing was stamped from
it, and no gate reads it. If you deleted the tree at bootstrap — a documented,
supported answer — a release's changes there are none of your business.

**With one exception, and 9b is where it reaches you.** No gate reads the
adapters, but the gate absolutely reads the *manual*, and a section you copy in
9b may cite an `adapters/…` path. A declined tree therefore constrains what your
manual may say: cite a file in a tree you do not have and step 10 goes red with
`path-missing`. Declining is a standing decision, and the manual layer has to
keep agreeing with it.

If you kept it, take whole directories:

```sh
kit archive "$TO_REF" adapters | tar -x
```

Never merge a single adapter file. Each directory is one worked wiring that has
to stay internally consistent; half of the release's on top of half of yours is a
configuration nobody has ever run.

## Step 10 — verify with the gate, then commit

Part 2 has no verbatim claim to check, so the gate is the check — and it is not a
formality here. It is what catches the quick-reference row whose skill you did not
copy, the article the manual points at that you never created, and the path
reference that moved.

```sh
sh scripts/check.sh
```

```sh
git add -A
git commit -m "chore: adopt kit ${TO_REF#v} outside the shared layer"

rm -rf "$WORK"   # the bare clone and both manifests — the update is over
```

That `rm` belongs *here* and nowhere earlier: `$WORK` holds the bare clone, both
manifests and `changed.yours`, and every step from 8 on reuses them.

Note it in `docs/diary.md` alongside the Part 1 entry. Part 2 is where the
release's behaviour actually changed, so it is the half a future reader will want
explained.

## Optional skills — adopting or declining one after bootstrap

The kit ships exactly one **optional** skill, `/dogfood`, and bootstrap asked
about it **once, at bootstrap**. There is no second question: bootstrap deleted
itself, and no update step will ever ask again. So both directions are manual,
and both are more than a directory.

**Adopting `/dogfood` later** — you now have a runnable user-facing surface:

```sh
kit archive "$TO_REF" .claude/skills/dogfood | tar -x
kit_take "$TO_REF" constitution/local-product.md.template \
	constitution/local-product.md.template
```

Then, by hand, the part no command can do for you — **in this order**:

1. **Fill in the DOGFOOD DECLARATION in `constitution/local-product.md.template`
   and drop the `.template` suffix**, exactly as with the other local articles.
   Until it is filled in, the skill stops and says so, which is correct: a
   guessed persona produces a report about a user who does not exist.
2. **Then copy the manual's `/dogfood` lines across, naming the `.md` you just
   produced.** `kit show "${TO_REF}:constitution/AGENTS.md.template"` shows exactly
   which lines bootstrap would have kept — they sit between
   `<!-- DOGFOOD:BEGIN -->` and `<!-- DOGFOOD:END -->`, and there are three of
   them: the quick-reference row, the paragraph that introduces the skill, and
   the article-layer pointer. **In the kit those lines name
   `constitution/local-product.md.template`, because in the kit it is still a
   template.** In your repo it is not. Re-point them at
   `constitution/local-product.md` as you copy — the same "change its pointer to
   the `.md` path" the manual's own kit note asks for.

Do it in the other order — rows first, rename second — and the gate stops you:
the pointer names a path you have just renamed away (`path-missing`) and the
article nobody points at is `article-unreferenced`. That is the framework
working, and it is still two steps you can simply take in the right order.

```sh
sh scripts/check.sh
```

**Declining it later** is the exact reverse, and the order matters just as much —
references first, then the files, so the gate is red in between rather than green
over a half-removal. So: remove *every* mention from the manual layer — the
quick-reference row, the paragraph that introduces it, and the article-layer
pointer — and only then delete what they pointed at.

```sh
rm -rf .claude/skills/dogfood
rm -f constitution/local-product.md constitution/local-product.md.template
```

```sh
sh scripts/check.sh
```

**The gate is the proof that nothing dangles.** A `/dogfood` mention left
anywhere in the manual layer with no skill directory behind it is `skill-missing`
and fails the push — which is the point. A half-removed skill is worse than
either whole state: the manual promises a command the repo does not have, and
every session loads that promise.

---

## Worked example — Part 2

The same test, a different consumer. This one bootstrapped at shared-layer
**0.3.0** with `/dogfood` declined, adapted `/to-tickets` with a local note (a
legitimate edit — skills are yours), **deleted `.github/workflows/tdd-pairing.yml`
on purpose** after folding that gate into its own CI, and has just finished Part
1: its `VERSION` says 0.10.0 and `scripts/agents.lib.sh` is on disk — and the gate
is **red** with `article-unreferenced`, because Part 1 landed the code-craft
article and nothing in this consumer's manual points at it yet. That pointer is
step 9b's hand edit, which is the point.

> **The file list below is this pair of releases, and this consumer.** What
> `changed.yours` prints is every non-shared path the kit touched between *your*
> two refs — a real `v0.3.0 → v0.10.0` clone prints more lines than the fixture
> here, because the fixture models only the parts of the wave the example is
> about. Read the transcript for the **shape** of each decision, never as a list
> to check yours against: a line you have and this one does not is normal.

**And nothing the release is for has arrived.** `tests/docs-demo.sh` asserts
exactly that before running a single Part 2 command: no `scripts/agents.config.sh`,
no `/improve-codebase-architecture`, no review workflow, no Deliver phase in
`/implement`, and a resolver that runs, prints nothing, and exits 0 — because an
unmapped tier is a working state. Beyond the article's red gate, the half-update
is *silent*, which is why that red is the only alarm that fires. Part 2 is what
fixes all of it:

```console
$ comm -23 "$WORK/changed.all" "$WORK/shared.all" >"$WORK/changed.yours"
$ cat "$WORK/changed.yours"
.claude/skills/dogfood/SKILL.md
.claude/skills/implement/SKILL.md
.claude/skills/improve-codebase-architecture/DEEPENING.md
.claude/skills/improve-codebase-architecture/INTERFACE-DESIGN.md
.claude/skills/improve-codebase-architecture/LANGUAGE.md
.claude/skills/improve-codebase-architecture/PRESENTING.md
.claude/skills/improve-codebase-architecture/SKILL.md
.claude/skills/to-tickets/SKILL.md
VERSION
adapters/claude-code/README.md
constitution/AGENTS.md.template
constitution/local-product.md.template
constitution/local-workflow.md.template
scripts/agents.config.sh
templates/workflows/ai-review-prompt.md
templates/workflows/ai-review.example.yml

$ # 9a — /implement: the kit changed it, we did not
$ kit diff --stat "$FROM_REF" "$TO_REF" -- "$S"
 .claude/skills/implement/SKILL.md | 20 ++++++++++++++++++++
 1 file changed, 20 insertions(+)
$ kit show "$FROM_REF:$S" | diff -u - "$S" | head -1
(no local edit — take it)
  took    .claude/skills/implement/SKILL.md

$ # 9a — /to-tickets: BOTH changed. Three-way, not a copy.
$ git merge-file "$T" "$WORK/base" "$WORK/theirs"
  merged clean — the kit's delta and our local note both survive

$ kit diff --name-only --diff-filter=A "$FROM_REF" "$TO_REF" -- .claude/skills
.claude/skills/dogfood/SKILL.md
.claude/skills/improve-codebase-architecture/DEEPENING.md
.claude/skills/improve-codebase-architecture/INTERFACE-DESIGN.md
.claude/skills/improve-codebase-architecture/LANGUAGE.md
.claude/skills/improve-codebase-architecture/PRESENTING.md
.claude/skills/improve-codebase-architecture/SKILL.md
$ kit archive "$TO_REF" .claude/skills/improve-codebase-architecture | tar -x
$ sh scripts/check.sh   # still red from Part 1: the ARTICLE is here; the manual does not know
FAIL  docs gate: violations found

FAIL  docs conformance: violations found

  [claude-md-refs] (1)
    x constitution/shared-code-craft.md [article-unreferenced] — is not referenced from AGENTS.md — no agent will ever be pointed at it
      -> Add a pointer to it in AGENTS.md's article layer, or delete the article — an unreachable standing instruction binds nobody and drifts unnoticed.

1 violation(s) across 1 validator(s).

Fix them, or see .githooks/pre-push for the logged bypass.

$ # 9b — new SECTIONS in the manual template we were stamped from
$ kit diff --stat "$FROM_REF" "$TO_REF" -- constitution/
 constitution/AGENTS.md.template         |  52 +++++++++++++
 constitution/local-product.md.template  | 103 +++++++++++++++++++++++++
 constitution/local-workflow.md.template |  43 +++++++++++
 constitution/shared-code-craft.md       | 129 ++++++++++++++++++++++++++++++++
 4 files changed, 327 insertions(+)
$ # copied across by hand: the Capability tiers section, and two rows
  edited  AGENTS.md (new section + three quick-reference rows + the code-craft pointer)

$ # 9c — workflow templates: installed once at bootstrap, never after
NEW       .github/workflows/ai-review-prompt.md
NEW       .github/workflows/ai-review.example.yml
UNCHANGED .github/workflows/commitlint.yml.example
UNCHANGED .github/workflows/docs-gate.yml
DECLINED  .github/workflows/tdd-pairing.yml
  took    .github/workflows/ai-review.example.yml + its prompt file

$ # 9d — config: MERGE, ADD or STAMPED? Ask about BOTH refs first.
$ # kit cat-file -e "${FROM_REF}:$C" — did it exist at the release we are on?
ADD     scripts/agents.config.sh is new at v0.10.0 — nothing of ours to preserve
$ sed -n 's/^\(AGENT_TIER_[A-Z]*\)=.*/\1/p' "$C"
AGENT_TIER_PLANNER
AGENT_TIER_IMPLEMENTER
AGENT_TIER_MECHANICAL
AGENT_TIER_REVIEWER
$ # …and the same three questions for the config bootstrap STAMPED
STAMPED scripts/docs-conformance/local-vocabulary.mjs — the kit has no such path at either ref
$ kit diff --stat "$FROM_REF" "$TO_REF" -- "$C.template"
(the source template did not change in this release)

$ # 9e — adapters: whole directories, or none
$ kit archive "$TO_REF" adapters | tar -x
README.md
claude-code
node-ts

$ sh scripts/check.sh
OK  docs gate: all checks passed (shared-layer 0.10.0, engine: harness)
```

Six things in that transcript are worth reading twice.

**`ADD     scripts/agents.config.sh is new at v0.10.0`.** The tier→model map did
not exist at 0.3.0; it arrived with the resolver. So this consumer copies the
whole file — nothing of theirs is at risk — and then edits it. That is *this*
pair of releases, not a rule: the same path is a destructive overwrite for a
consumer who already had the file, which is why 9d asks before it writes.

**`STAMPED scripts/docs-conformance/local-vocabulary.mjs`, two lines below it.**
Same command, same pair of releases, opposite answer — and the reason is not the
release at all. The kit has never had that path: bootstrap *stamps* it from
`local-vocabulary.mjs.template`, so `cat-file -e` is false at both ends. A
version of 9d that asked only about `FROM_REF` printed `ADD` here and emptied
the file, which is what the third verdict exists to stop. The line above it and
the line below it are the same question with three possible answers, and only
asking twice tells them apart.

**`merged clean — the kit's delta and our local note both survive`.** The kit
added a tier rubric to `/to-tickets`; the consumer had added a line of their own.
A copy would have destroyed one of them, and a byte comparison would have called
a legitimate local adaptation "drift". Neither is the right question for a skill.

**The gate ran twice, and the first run was red.** Red since Part 1, in fact —
`article-unreferenced`, the shared article with no manual pointer — and landing
the new skill's directory changed nothing, because the two absences are treated
oppositely on purpose: a skill with no row is merely invisible, while an article
with no pointer is a violation. The teeth meet in the middle — a row with no
skill is `skill-missing`, an article with no pointer is `article-unreferenced` —
which is what makes 9b's hand edits steps rather than suggestions. The test
proves both directions, and proves them again for `/dogfood` adopted and then
declined after bootstrap.

**`NEW       .github/workflows/ai-review-prompt.md`.** The workflow next to it
reads that file at run time. Taking one and not the other produces a review
workflow that fails on its first PR — which is why 9c says take a template with
its neighbours.

**`DECLINED  .github/workflows/tdd-pairing.yml`, one line below two `NEW`s.**
All three are files that are not in `.github/workflows/`, and only two of them
are missing by accident. This consumer folded the pairing gate into its own CI
and deleted the kit's copy; the release did not touch that file, so there is
nothing to adopt and nothing to decide. A classifier that only asks "is it
there?" prints `NEW` for all three, and the reader — reasonably — adds a
duplicate gate to every PR of theirs.
