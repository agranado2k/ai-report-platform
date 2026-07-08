/**
 * Best-effort DOM/text-level diff for version pairs where at least one side
 * lacks a `_source.json` sidecar (ADR-0065 §3) — most commonly an
 * externally-uploaded version never opened in the editor, so there is no
 * ProseMirror doc JSON to feed `diffDocs`/`diffRendered`. Deliberately
 * lower-fidelity: it treats each top-level tag boundary as an opaque
 * comparison unit ("block"), strips it down to plain text, and runs a
 * classic LCS diff over those text units, so a single changed word inside a
 * block marks the *whole* block changed rather than pinpointing the word.
 * `label` must always be surfaced by the caller alongside `html` so this is
 * never mistaken for the word-level structural diff (ADR-0065 §3's explicit
 * requirement).
 *
 * SECURITY: unlike `diffRendered` (which only ever touches doc JSON that
 * already passed through `reportSchema`'s parse — the sanitizing boundary
 * `security.test.ts` verifies strips scripts/handlers/CSS-exfiltration
 * vectors), this fallback exists precisely BECAUSE that sanitizing pipeline
 * was never run on this content (no sidecar = never opened in the editor).
 * The input is raw, unsanitized, possibly-attacker-controlled uploaded HTML
 * — exactly what ADR-002/ADR-013's origin isolation says must never render
 * outside the sandboxed view.<domain> origin. So this diff reduces every
 * block to plain text (`stripTags`) and HTML-escapes it (`escapeHtml`)
 * before ever building the output string — the returned `html` contains
 * only markup this module authored itself (the `<div class="…">` wrappers),
 * never a live tag/attribute from the input. Safe to render on the
 * dashboard (app) origin; the structural diff and this fallback are the
 * ONLY two ways report content ever reaches the app origin, and both are
 * sanitized-by-construction for different reasons.
 */

/** The exact wording ADR-0065 §3 requires the UI to show next to this diff. */
export const STRUCTURAL_DIFF_UNAVAILABLE_LABEL = "structural diff unavailable — raw comparison";

/** Class wrapping a block only present in the newer version. */
export const FALLBACK_INS_CLASS = "rd-diff-ins-block";
/** Class wrapping a block only present in the older version. */
export const FALLBACK_DEL_CLASS = "rd-diff-del-block";

export interface HtmlFallbackDiff {
  readonly html: string;
  readonly label: string;
}

/**
 * Split HTML into coarse "blocks" by inserting a boundary at every
 * `><` tag-adjacency, strip every tag down to plain text, then trim/drop
 * empty lines. Not a real parse — deliberately so: this fallback exists
 * precisely because there's no structured document to parse. Stripping tags
 * here (rather than at output time) also means the diff itself compares
 * *content*, not markup — two blocks with identical text but different
 * wrapper tags count as unchanged.
 */
function toBlocks(html: string): readonly string[] {
  return html
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((block) => stripTags(block).trim())
    .filter((block) => block.length > 0);
}

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, "");
}

/** Escape plain text for safe interpolation into the hand-built output markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type DiffOp =
  | { readonly kind: "equal"; readonly value: string }
  | { readonly kind: "insert"; readonly value: string }
  | { readonly kind: "delete"; readonly value: string };

/** Classic O(n*m) LCS diff over opaque string units — fine at report-body block counts. */
function lcsDiff(a: readonly string[], b: readonly string[]): readonly DiffOp[] {
  const n = a.length;
  const m = b.length;
  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const lengthAt = (i: number, j: number): number => lengths[i]?.[j] ?? 0;

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = lengths[i];
      if (!row) continue;
      row[j] =
        a[i] === b[j]
          ? lengthAt(i + 1, j + 1) + 1
          : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const valueA = a[i];
    const valueB = b[j];
    if (valueA === undefined || valueB === undefined) break;
    if (valueA === valueB) {
      ops.push({ kind: "equal", value: valueA });
      i += 1;
      j += 1;
    } else if (lengthAt(i + 1, j) >= lengthAt(i, j + 1)) {
      ops.push({ kind: "delete", value: valueA });
      i += 1;
    } else {
      ops.push({ kind: "insert", value: valueB });
      j += 1;
    }
  }
  while (i < n) {
    const valueA = a[i];
    if (valueA !== undefined) ops.push({ kind: "delete", value: valueA });
    i += 1;
  }
  while (j < m) {
    const valueB = b[j];
    if (valueB !== undefined) ops.push({ kind: "insert", value: valueB });
    j += 1;
  }
  return ops;
}

/** Diff two raw HTML strings at the block level, clearly labeled as lower-fidelity (ADR-0065 §3). */
export function diffHtmlFallback(oldHtml: string, newHtml: string): HtmlFallbackDiff {
  const ops = lcsDiff(toBlocks(oldHtml), toBlocks(newHtml));

  const html = ops
    .map((op) => {
      const safe = escapeHtml(op.value);
      if (op.kind === "equal") return `<p>${safe}</p>`;
      if (op.kind === "insert") return `<div class="${FALLBACK_INS_CLASS}">${safe}</div>`;
      return `<div class="${FALLBACK_DEL_CLASS}">${safe}</div>`;
    })
    .join("\n");

  return { html, label: STRUCTURAL_DIFF_UNAVAILABLE_LABEL };
}
