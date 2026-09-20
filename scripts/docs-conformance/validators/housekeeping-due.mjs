// The diary's HOUSEKEEPING clock, refereed. Standing instructions rot on a
// calendar, not on an event: the manual's counts drift, quick-reference rows
// outlive their skills, the glossary and the code stop agreeing — and the
// diary's protocol is event-triggered, so nothing ever says "it has been a
// while" (PRD #107). The diary template's Current state table now carries a
// `**Last housekeeping**` row holding the ISO date of the last pass; this
// validator reads it and warns when the date is older than the window the
// gate config names. The nudge lands here, on the pre-push path, because the
// gate is the one clock every harness already runs.
//
// Findings here are WARNINGS, the same posture as the other advisories, for
// the same structural reason and one more: an overdue pass must never block a
// hotfix. The promotion path, if the warning proves ignorable: flip the
// severity once consumers have lived with the row for a release or two.
//
// A tree with NO diary produces no finding: the diary-not-written state is
// the manual layer's business (the root points at the diary, and path-missing
// says so), not this rule's.

import { stripFences } from "./claude-md-refs.mjs";

export const id = "housekeeping-due";

export const ROW_LABEL = "Last housekeeping";
export const DEFAULT_WINDOW_DAYS = 30;
export const DEFAULT_DIARY = "docs/diary.md";
const DAY_MS = 24 * 60 * 60 * 1000;

// The row as the template stamps it: a table row whose first cell is the bold
// label, whose second cell starts with an ISO date. The date is read up to
// the next whitespace OR the closing pipe, so a compact row (`| 2026-01-01 |`
// with no space before the pipe) reads the same as a spaced one. Anything
// after the date on the row is the pass's one-line note and is not read. The
// row is matched anywhere in the fence-stripped diary, not only in the
// Current state block: the template puts it there, and a consumer who moved
// it still recorded a pass.
const ROW_RE = new RegExp(
  `^\\|[^\\S\\n]*\\*\\*${ROW_LABEL}\\*\\*[^\\S\\n]*\\|[^\\S\\n]*([^\\s|]*)`,
  "m",
);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function run(ctx) {
  const cfg = ctx.config.housekeepingDue ?? {};
  const diary = cfg.diary ?? DEFAULT_DIARY;
  const windowDays = cfg.windowDays ?? DEFAULT_WINDOW_DAYS;

  if (!ctx.exists(diary)) return [];
  const raw = ctx.read(diary);
  if (raw == null) return [];

  // Fences are stripped first: a diary QUOTING the row convention in a code
  // block has not recorded a pass.
  const match = ROW_RE.exec(stripFences(raw));
  const dateText = match?.[1] ?? "";
  if (!ISO_RE.test(dateText) || Number.isNaN(Date.parse(dateText))) {
    return [
      {
        validator: id,
        severity: "warning",
        file: diary,
        rule: "housekeeping-row-missing",
        message: `has no \`**${ROW_LABEL}**\` row with a valid ISO date anywhere in the diary`,
        hint: `Add the row \`| **${ROW_LABEL}** | YYYY-MM-DD — <what the pass found> |\`, dated the last housekeeping pass (or today, if none has run yet). The housekeeping-due advisory reads it and nudges after ${windowDays} days (housekeepingDue.windowDays in the gate config).`,
      },
    ];
  }

  // The row's date parses as UTC midnight, so near a day boundary the age can
  // read one day high or low against the operator's clock — within a window
  // measured in weeks, not a distinction worth a time zone in the diary.
  const ageDays = Math.floor((Date.now() - Date.parse(dateText)) / DAY_MS);
  // A row dated in the future is the one shape that would silence the nudge
  // indefinitely — a mistyped year — so it is a malformed row, not a fresh one.
  if (ageDays < 0) {
    return [
      {
        validator: id,
        severity: "warning",
        file: diary,
        rule: "housekeeping-row-missing",
        message: `has a \`**${ROW_LABEL}**\` row dated ${dateText}, which is in the future`,
        hint: "A future date would silence the housekeeping nudge forever. Date the row the day of the last pass, or today.",
      },
    ];
  }
  if (ageDays <= windowDays) return [];

  return [
    {
      validator: id,
      severity: "warning",
      file: diary,
      rule: "housekeeping-due",
      message: `last housekeeping was ${dateText}, ${ageDays} days ago — the window is ${windowDays} days`,
      hint: "Run `/housekeeping` and let it stamp the row with today's date. Standing instructions rot on a calendar: the pass is where drifted counts, dead rows, unreferenced articles and unmeasured suites get found. Widen housekeepingDue.windowDays in the gate config if a month is the wrong cadence for this repo.",
    },
  ];
}
