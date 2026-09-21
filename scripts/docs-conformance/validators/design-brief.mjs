// The engineering article's DESIGN BRIEF, refereed. Nothing in the kit asked
// a consumer what shape its system is: the Architecture section shipped as
// blanks, so the first feature diff picked a paradigm and a style by accident
// and every later diff conformed to the accident (PRD #107). The template now
// stamps three labeled anchors — the paradigm, the architectural style, and
// the context map — each with exactly two honest forms: a decision, or an
// explicit none-with-reason. This validator asks whether a FILLED article
// still carries at least one of them. Silence on all three is the one shape
// it names; a single recorded decision is a brief, and which anchors a
// project fills is the project's call.
//
// Findings here are WARNINGS, the same posture as the other advisories (the
// glossary's **Advisory** entry is the roster), and for the same structural
// reason: the stamped article
// is CONSUMER-OWNED prose, and an article filled from a pre-0.15.0 template is
// sanctioned version skew, not a defect — a red gate would punish every
// consumer whose article predates the anchors. The promotion path, if the
// warning proves ignorable: flip this validator's severity once the anchors
// have been in every supported release long enough that "my template
// predates them" stops being true.
//
// A repo with NO stamped article produces no finding: the article-not-written
// state belongs to the templates-stamped and article-reachability rules, not
// to this one.

import { stripFences } from "./claude-md-refs.mjs";

export const id = "design-brief";

// The labels are API: the template stamps them and this rule reads them. One
// list, exported so the fixture suite can hold the template's labels to it and
// exercise each one alone.
export const ANCHORS = ["Paradigm", "Architectural style", "Context map"];

// [^\S\n]* — horizontal whitespace only, for the reason mutation-decision
// records: a bare \s* would eat the line break and read the NEXT line's first
// character as the decision.
const anchorRe = (label) => new RegExp(`^\\*\\*${label}\\*\\*:[^\\S\\n]*\\S`, "m");
const ANCHOR_RES = ANCHORS.map(anchorRe);

export function run(ctx) {
  const refsCfg = ctx.config.claudeMdRefs ?? {};
  const cfg = ctx.config.designBrief ?? {};
  const dir = refsCfg.constitutionDir ?? "constitution";
  const article = cfg.article ?? `${dir}/local-engineering.md`;

  if (!ctx.exists(article)) return [];
  const raw = ctx.read(article);
  if (raw == null) return [];
  // Fences are stripped first: an article QUOTING the anchor convention in a
  // code block has not made a decision.
  const text = stripFences(raw);
  if (ANCHOR_RES.some((re) => re.test(text))) return [];

  const labels = ANCHORS.map((a) => `\`**${a}**:\``).join(", ");
  return [
    {
      validator: id,
      severity: "warning",
      file: article,
      rule: "design-brief-missing",
      message: `records no design brief — none of ${labels} carries a decision`,
      hint: "Fill at least one anchor: name the decision, or write `none — <reason>`. An Architecture section nobody decided is decided by the first feature diff instead.",
    },
  ];
}
