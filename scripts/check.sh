#!/bin/sh
# The docs gate.
#
# Shared invariant §8: "a rule written in a document that nothing checks decays
# into a lie, and stale standing instructions are worse than absent ones."
# This script is that enforcement for a bootstrapped project.
#
# ---------------------------------------------------------------------------
# TWO ENGINES, ONE GATE — and why
# ---------------------------------------------------------------------------
# The kit's core is language-agnostic on purpose: a project that has not chosen
# a toolchain yet must still inherit a working gate on day one. But the
# reference checks worth having (slash-command resolution, the article layer,
# reachability, the portability deny-list) are real parsing work, and POSIX sh
# is the wrong tool for them — the shell version of the path check below is a
# word-splitter that cannot tell a code span from a fence.
#
# So the gate is split by what each check actually needs:
#
#   ALWAYS, in POSIX sh — the checks that are cheap AND exact in shell:
#     1. placeholder-unstamped  no double-brace mark survived bootstrap
#     2. shared-layer-missing   every file VERSION lists still exists
#     3. root-manual-missing    the root agent manual (AGENTS.md) exists at all
#
#   (3) stays in shell rather than moving into the harness on purpose: the
#   harness treats an absent manual as "this repo does not model that layer" and
#   stays silent, which is right for a validator run over fixture trees and
#   wrong for a gate. A bootstrapped project without a root manual is broken,
#   whichever engine is available.
#
#   REFERENCES — delegated to the node harness (scripts/docs-conformance) when
#   node is on PATH. That is the real validator: layered manuals, command
#   resolution, article reachability, package-relative paths, and the
#   portability deny-list on the shared article.
#
#   NO NODE? A reduced POSIX fallback runs instead: repo paths named in code
#   spans of the root manual and the articles must exist. It prints a NOTICE
#   saying exactly what it is NOT checking, because a gate that quietly
#   downgrades itself is how a project ends up believing in coverage it lost.
#
# Set DOCS_CHECK_NO_NODE=1 to force the fallback (the kit's demo does, to prove
# both engines).
#
# Exit: 0 clean, 1 violations found, 2 could not run. A clean run may still
# write the harness's advisory block to stderr — advisories are relayed on a
# green gate and never change the exit code.

set -u

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd)
cd "$repo_root" || {
	echo "check.sh: cannot enter repo root '$repo_root'" >&2
	exit 2
}

HARNESS="scripts/docs-conformance/index.mjs"
# The header the harness prints above its advisory block. Keep this in step
# with `scripts/docs-conformance/index.mjs` — two engines, one contract; the
# advisory suite goes red if the two drift.
advisory_header="WARN  docs conformance"

# Findings go to a tempfile rather than a variable because every scan below
# is a `while … done` fed by a pipe, which POSIX sh runs in a subshell: a flag
# set inside it is lost when the loop ends. The file is the one channel that
# survives; "any finding at all" is then the file's size (see posix_failed).
vfile=$(mktemp) || exit 2
trap 'rm -f "$vfile"' EXIT INT TERM HUP

# report <rule> <file> <message> <hint>
report() {
	printf '  [%s] %s\n    x %s\n      -> %s\n\n' "$1" "$2" "$3" "$4" >>"$vfile"
}

# The reviewed surface. `git ls-files -co --exclude-standard` is tracked files
# PLUS untracked-but-not-ignored ones, which is exactly right for a project that
# has just been bootstrapped and has not committed yet, while still respecting
# .gitignore so build output never reaches the gate.
list_files() {
	if git rev-parse --git-dir >/dev/null 2>&1; then
		git ls-files -co --exclude-standard
	else
		find . -type f ! -path './.git/*' | sed 's|^\./||'
	fi
}

# ---------------------------------------------------------------------------
# 1. No unstamped placeholders  (always, POSIX)
# ---------------------------------------------------------------------------
# The pattern is assembled from variables so this script does not itself contain
# the literal mark. Otherwise the gate would have to exempt its own source, and
# a gate with a blind spot over itself is not a gate.
ob='{'
cb='}'
placeholder_re="${ob}${ob}[A-Z][A-Z0-9_]*${cb}${cb}"

list_files | while IFS= read -r f; do
	[ -f "$f" ] || continue
	# `*.template` files are SUPPOSED to carry placeholders — they are the
	# unstamped source bootstrap (or you, by hand) reads. Everything else is
	# stamped output and is held to it.
	case "$f" in
	*.template) continue ;;
	esac
	grep -n -I "$placeholder_re" "$f" 2>/dev/null | while IFS= read -r hit; do
		report "placeholder-unstamped" "$f:${hit%%:*}" \
			"still contains an unstamped placeholder" \
			"Stamp it, or delete the line. An agent loading this file loads the hole."
	done
done

# ---------------------------------------------------------------------------
# 2. The shared layer named in VERSION is intact  (always, POSIX)
# ---------------------------------------------------------------------------
if [ ! -f VERSION ]; then
	report "shared-layer-missing" "VERSION" \
		"the shared-layer manifest does not exist" \
		"Restore VERSION from the kit — without it nothing records which files are shared layer, or at which version."
else
	shared_version=$(sed -n 's/^shared-layer:[[:space:]]*//p' VERSION | head -1)
	[ -n "$shared_version" ] || report "shared-layer-missing" "VERSION" \
		"has no 'shared-layer: <version>' line" \
		"The manifest must state the version it pins, or the update recipe has no anchor to diff from."

	# One grammar for the manifest, shared with bootstrap and the suites; the
	# module is itself manifest-listed, so a consumer's gate has it — and the
	# gate fails CLOSED without it: a missing module is a missing shared file,
	# and a module that defines nothing is a broken gate, never a silent pass.
	manifest_lib="$repo_root/scripts/manifest.lib.sh"
	if [ ! -r "$manifest_lib" ]; then
		report "shared-layer-missing" "scripts/manifest.lib.sh" \
			"the manifest parser is missing, so the shared-layer check cannot run" \
			"Restore scripts/manifest.lib.sh from the kit at the pinned version; scripts/check.sh sources it."
	else
		# shellcheck disable=SC1090
		. "$manifest_lib"
		command -v manifest_section >/dev/null 2>&1 || {
			echo "check.sh: scripts/manifest.lib.sh did not define manifest_section — the gate cannot run" >&2
			exit 2
		}
	fi
	command -v manifest_section >/dev/null 2>&1 && manifest_section files <VERSION | while IFS= read -r shared; do
		[ -e "$shared" ] && continue
		report "shared-layer-missing" "$shared" \
			"is listed in VERSION as shared layer but does not exist" \
			"Restore it from the kit at the pinned version. Shared-layer files are copied verbatim, not edited or deleted locally."
	done
fi

# ---------------------------------------------------------------------------
# 3. The root agent manual exists  (always, POSIX)
# ---------------------------------------------------------------------------
# AGENTS.md, not a tool-specific filename: one manual, and the tool-specific
# files beside it are shims that import it. The harness checks the shims' shape
# (`shim-invalid`); this shell check owns only the manual's existence, because
# an absent manual breaks the repo whichever engine is available.
[ -f AGENTS.md ] || report "root-manual-missing" "AGENTS.md" \
	"the root agent manual does not exist" \
	"Run bootstrap.sh to stamp constitution/AGENTS.md.template into AGENTS.md. Every other layer hangs off this one, and CLAUDE.md / GEMINI.md are only shims importing it."

# ---------------------------------------------------------------------------
# 4. References — the node harness, or the reduced POSIX fallback
# ---------------------------------------------------------------------------
harness_out=""
harness_status=0
engine="fallback"

if [ "${DOCS_CHECK_NO_NODE:-}" != "1" ] && [ -f "$HARNESS" ] && command -v node >/dev/null 2>&1; then
	engine="docs harness"
	harness_out=$(node "$HARNESS" "$repo_root" 2>&1)
	harness_status=$?
fi

if [ "$engine" = "fallback" ]; then
	# Reduced form. Path roots: the trees a manual is allowed to point into. A
	# backticked token that starts with one of these roots followed by `/` is
	# a repo path and must resolve; anything else is left alone. A root may
	# itself carry a `/` (`.agents/skills`), exactly as the harness's do.
	#
	# This list IS `claudeMdRefs.pathRoots` in scripts/docs-conformance/
	# config.mjs, entry for entry — two engines, one policy, and the
	# duplication is the price of running without a runtime. The harness's
	# list is the truth; tests/gate-path-roots.test.sh fails when they differ.
	path_roots='constitution scripts docs tests adapters .githooks .github .agents/skills .claude/hooks .claude/skills .claude/constitution'

	scan_manual() {
		manual=$1
		[ -f "$manual" ] || return 0
		# Strip fenced blocks (their ``` markers would be read as span
		# delimiters), pull out every `code span`, then split spans into words so
		# a span like `sh scripts/check.sh` still yields the path.
		awk '/^[ \t]*(```|~~~)/ { fence = !fence; next } !fence { print }' "$manual" |
			grep -o '`[^`]*`' |
			tr -d '`' |
			tr ' \t' '\n\n' |
			sort -u |
			while IFS= read -r token; do
				case "$token" in
				*/*) ;;
				*) continue ;; # no separator: not a path
				esac
				# Globs are patterns, not paths — the harness ignores them too.
				case "$token" in
				*'*'* | *'?'*) continue ;;
				esac
				is_root=0
				for r in $path_roots; do
					case "$token" in
					"$r"/*) is_root=1 && break ;;
					esac
				done
				[ "$is_root" = 1 ] || continue
				# Trailing punctuation from prose, and trailing slash on dirs.
				clean=$(printf '%s' "$token" | sed 's/[.,;:)]*$//')
				if [ -e "$clean" ] || [ -e "${clean%/}" ]; then
					continue
				fi
				report "path-missing" "$manual" \
					"references \`$token\` but that path does not exist" \
					"Create it or remove the reference — the manual must describe reality, not intent."
			done
	}

	scan_manual AGENTS.md
	for article in constitution/*.md; do
		[ -e "$article" ] || continue
		case "$article" in
		constitution/shared-invariants.md | constitution/shared-code-craft.md) continue ;; # shared layer: portability is the harness's job
		esac
		scan_manual "$article"
	done
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [ "$engine" = "fallback" ]; then
	echo "NOTICE  docs gate running WITHOUT node — reduced coverage." >&2
	echo "        Checked: unstamped placeholders, shared-layer manifest, repo paths in the manual layer." >&2
	echo "        NOT checked: slash-command resolution, article reachability, nested manuals," >&2
	echo "        package-relative paths, shim integrity (CLAUDE.md / GEMINI.md) and the" >&2
	echo "        portability deny-list on the shared article — the claude-md-refs rules" >&2
	echo "        beyond repo paths; cross-skill references (the skill-web advisory)," >&2
	echo "        path references inside skill bodies" >&2
	echo "        (the skill-paths rule), the engineering article's mutation" >&2
	echo "        decision (the mutation-decision advisory) and its design brief" >&2
	echo "        (the design-brief advisory), the diary's housekeeping date (the" >&2
	echo "        housekeeping-due advisory), materialized skill-bridge symlinks" >&2
	echo "        (the skill-bridge advisory), and the glossary's banned words" >&2
	echo "        (the banned-words advisory)." >&2
	echo "        Install node and re-run to get the full harness (scripts/docs-conformance)." >&2
	echo "" >&2
fi

posix_failed=0
[ -s "$vfile" ] && posix_failed=1

if [ "$posix_failed" = 0 ] && [ "$harness_status" = 0 ]; then
	# A green harness may still carry ADVISORIES — findings on the warning
	# channel that never fail the gate. Relay them: this wrapper is the entry
	# point the hook and CI run, and a warning only the harness printed is a
	# warning nobody saw. Quiet when there is nothing to advise, and trimmed
	# to the advisory block — the harness's own OK line is not repeated.
	case "$harness_out" in
	*"$advisory_header"*)
		printf '%s\n' "$harness_out" | sed '/^OK  docs conformance/d' >&2
		;;
	esac
	echo "OK  docs gate: all checks passed (shared-layer ${shared_version:-unknown}, engine: $engine)"
	exit 0
fi

echo "FAIL  docs gate: violations found" >&2
echo "" >&2
if [ "$posix_failed" = 1 ]; then
	cat "$vfile" >&2
fi
if [ "$harness_status" != 0 ] && [ -n "$harness_out" ]; then
	printf '%s\n\n' "$harness_out" >&2
fi
echo "Fix them, or see .githooks/pre-push for the logged bypass." >&2
exit 1
