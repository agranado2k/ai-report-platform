#!/bin/sh
# scripts/manifest.lib.sh — the one grammar for VERSION's manifest sections.
#
# VERSION carries two lists in one format: `files:` (the shared layer) and
# `skills:` (the roster). An entry is an indented line; its NAME is the first
# word, and anything after it is annotation. Comments and blank lines inside a
# list are skipped; the list ends at the first line that is not indented.
#
# Sourceable (`. scripts/manifest.lib.sh`), then:
#
#   manifest_section files  <VERSION     # one path per line
#   manifest_section skills <VERSION     # one skill name per line
#
# The manifest arrives on STDIN, because the callers differ only in where the
# bytes come from — a file on disk, or `git show <ref>:VERSION` from a bare
# clone — and the grammar must not. A section that is absent prints nothing
# and exits 0; the update recipe relies on that silence being testable.
#
# Shared layer: this file is manifest-listed and copied verbatim into a
# consumer, where scripts/check.sh sources it. UPDATING.md deliberately keeps
# its own two copies of this awk — the recipe runs in a consumer at an OLDER
# release, where the local copy of this file is the old one — and
# tests/manifest.test.sh holds those copies equal to this grammar.
#
# Exit: 0 always for a readable stream; 2 when the section name is malformed.

manifest_section() {
	# Spelled out rather than a-z: under a UTF-8 locale a range can admit
	# capitals on some shells, and a section name is a caller-supplied literal.
	case "${1:-}" in
	'' | [!abcdefghijklmnopqrstuvwxyz]* | *[!abcdefghijklmnopqrstuvwxyz-]*)
		printf '%s\n' "manifest_section: section must be a lowercase word (files, skills); got '${1:-}'" >&2
		return 2
		;;
	esac
	awk -v section="$1" '
		BEGIN { header = "^" section ":" }
		$0 ~ header     { inlist = 1; next }
		!inlist         { next }
		/^[ \t]*#/      { next }
		/^[ \t]*$/      { next }
		/^[ \t]+[^ \t]/ { sub(/^[ \t]+/, ""); print $1; next }
		                { inlist = 0 }
	'
}
