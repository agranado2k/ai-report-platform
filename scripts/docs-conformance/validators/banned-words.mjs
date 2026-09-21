// The glossary's OTHER half, refereed. A ubiquitous language names one word
// per concept and, just as importantly, names the words it does NOT use — the
// ones that are ambiguous in this project. The glossary template ships that
// section ("Words this project does not use"); nothing read it. This
// validator does: each entry's banned term is searched for in the manual
// layer, the skills, and the glossary itself — minus the banned section and
// every _Avoid_ item, whose job is to write the word — and every use is a
// WARNING naming the word and the replacement the entry prescribes.
//
// An entry may carve out a legitimate sense with an `Except:` clause whose
// code spans are the phrases in which the word is fine — `dependency
// install` for a word banned in its bootstrap sense. A use inside one of
// those phrases is silent. Quoted material is silent too: fenced blocks and
// code spans are commands and paths, not prose.
//
// Warnings, never violations: a banned word is a wording debt, and the
// glossary is the consumer's own policy — an entry added on Monday must not
// break Tuesday's hotfix push. A glossary with no such section, or no entries
// in it, produces nothing.

import { DEFAULT_SKILLS_DIR, skillHomes, stripFences } from "./claude-md-refs.mjs";

export const id = "banned-words";

// The same defaults the reference validator applies when the policy is
// silent; read from config.claudeMdRefs first, as every validator does.
const DEFAULT_ROOT_MANUAL = "AGENTS.md";
const DEFAULT_CONSTITUTION_DIR = "constitution";

export const DEFAULT_GLOSSARY = "docs/domain-glossary.md";
export const SECTION_HEADING = "Words this project does not use";
// The shared articles are copied verbatim from the kit: a consumer's banned
// list cannot be a rule about prose the consumer may not edit. Named by
// basename, joined to the configured constitution directory at scan time.
export const SHARED_ARTICLES = ["shared-invariants.md", "shared-code-craft.md"];

const SUFFIX = "(?:s|es|ed|ing)?";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The section's text: from its heading to the next heading of the same or higher level. */
function bannedSection(raw) {
  const lines = stripFences(raw).split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0) {
      if (m[2] === SECTION_HEADING) {
        start = i + 1;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start < 0 ? null : lines.slice(start).join("\n");
}

/**
 * Parse the section's entries. One entry is a list item starting with a bold
 * term: `- **term** — why. Use **x** or **y**. Except: **sense** — `phrase`,
 * `phrase`.` Continuation lines belong to the item above them.
 */
export function parseEntries(sectionText) {
  const items = [];
  for (const line of sectionText.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (/^\s*[-*]\s+\*\*/.test(line)) items.push(line.replace(/^\s*[-*]\s+/, ""));
    else if (items.length && line.trim()) items[items.length - 1] += " " + line.trim();
  }
  const entries = [];
  for (const item of items) {
    const term = /^\*\*(.+?)\*\*/.exec(item)?.[1]?.trim();
    if (!term || /^<.*>$/.test(term)) continue; // the template's placeholder entry
    const exceptAt = item.indexOf("Except:");
    const body = exceptAt >= 0 ? item.slice(0, exceptAt) : item;
    const except = exceptAt >= 0 ? item.slice(exceptAt) : "";
    const useAt = body.search(/\bUse\b/);
    const replacements = useAt >= 0 ? [...body.slice(useAt).matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]) : [];
    // The entry's own guidance, for the message when it names no bold
    // replacement ("Say which."): everything after the term, plain.
    const guidance = body.replace(/^\*\*.+?\*\*\s*[—–-]?\s*/, "").replace(/\*\*/g, "").trim();
    const allowed = [...except.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    entries.push({ term, replacements, guidance, allowed });
  }
  return entries;
}

/**
 * Prose only, with every line still on its own line so a match's offset maps
 * back to a line number: fenced blocks are blanked line by line (not removed,
 * as stripFences does), and code spans are blanked in place.
 */
function prose(raw) {
  const out = [];
  let fence = false;
  for (const line of raw.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push("");
    } else out.push(fence ? "" : line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length)));
  }
  return out.join("\n");
}

/** The 1-based line of a character offset in text. */
function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The glossary's scannable prose: the banned section and every `_Avoid_:`
 *  line blanked in place. */
function glossaryProse(text) {
  const lines = text.split("\n");
  let inBanned = false;
  let level = 0;
  // An _Avoid_ item runs until a line indented no deeper than its own bullet
  // — the next bullet, a blank, or a heading — so a near-synonym named on its
  // second line is as exempt as one on its first.
  let avoidIndent = -1;
  return lines
    .map((line) => {
      const h = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
      if (h) {
        avoidIndent = -1;
        if (inBanned && h[1].length <= level) inBanned = false;
        if (!inBanned && h[2] === SECTION_HEADING) {
          inBanned = true;
          level = h[1].length;
        }
      }
      const avoid = /^(\s*)[-*]\s+_Avoid_:/.exec(line);
      if (avoid) avoidIndent = avoid[1].length;
      else if (avoidIndent >= 0) {
        const indent = /^(\s*)\S/.exec(line);
        if (!indent || indent[1].length <= avoidIndent) avoidIndent = -1;
      }
      if (inBanned || avoidIndent >= 0) return line.replace(/[^\n]/g, " ");
      return line;
    })
    .join("\n");
}

function scanTargets(ctx) {
  const refs = ctx.config.claudeMdRefs ?? {};
  const cfg = ctx.config.bannedWords ?? {};
  const rootManual = refs.rootManual ?? DEFAULT_ROOT_MANUAL;
  const constitutionDir = refs.constitutionDir ?? DEFAULT_CONSTITUTION_DIR;
  const skillsDir = refs.skillsDir ?? DEFAULT_SKILLS_DIR;
  const exclude = new Set(cfg.exclude ?? SHARED_ARTICLES.map((f) => `${constitutionDir}/${f}`));
  const files = [rootManual];
  for (const f of ctx.list(constitutionDir, ".md")) files.push(`${constitutionDir}/${f}`);
  const seen = new Set();
  for (const home of skillHomes(skillsDir)) {
    for (const name of ctx.list(home)) {
      // A skill is a directory holding SKILL.md; a licence file or a stray
      // beside the skills is neither and is not listed into.
      if (seen.has(name) || !ctx.exists(`${home}/${name}/SKILL.md`)) continue;
      seen.add(name);
      for (const f of ctx.list(`${home}/${name}`, ".md")) files.push(`${home}/${name}/${f}`);
    }
  }
  return files.filter((f) => !exclude.has(f));
}

export function run(ctx) {
  const cfg = ctx.config.bannedWords ?? {};
  const glossary = cfg.glossary ?? DEFAULT_GLOSSARY;
  const glossaryRaw = ctx.read(glossary);
  if (glossaryRaw == null) return [];
  const section = bannedSection(glossaryRaw);
  if (section == null) return [];
  const entries = parseEntries(section);
  if (entries.length === 0) return [];

  const out = [];
  // The glossary is scanned too — it is the canonical document for the
  // language and was the one file free to contradict the rule it defines:
  // after a word was banned, two of the glossary's own entries went on using
  // it, and nothing said so until a reviewer read them by hand. Two parts of
  // it are exempt because writing the word is their job: the banned section
  // itself, and any `_Avoid_:` line, which exists to name the near-synonym.
  // Both are blanked rather than cut, so line numbers stay true.
  for (const file of [...scanTargets(ctx), glossary]) {
    const raw = ctx.read(file);
    if (raw == null) continue;
    const body = file === glossary ? glossaryProse(prose(raw)) : prose(raw);
    for (const entry of entries) {
      // Matched over the whole text with whitespace in a phrase matching any
      // run of it, so a multi-word term split across a line break is still
      // a use; the line reported is the one the match starts on.
      const termRe = new RegExp(`\\b${escapeRe(entry.term).replace(/\s+/g, "\\s+")}${SUFFIX}\\b`, "gi");
      // Carved-out phrases are blanked before the word is looked for, so a
      // use inside one cannot match.
      let text = body;
      for (const phrase of entry.allowed) {
        text = text.replace(new RegExp(escapeRe(phrase).replace(/\s+/g, "\\s+"), "gi"), (m) => m.replace(/[^\n]/g, " "));
      }
      for (const m of text.matchAll(termRe)) {
        const line = lineAt(text, m.index);
        const says = entry.replacements.length
          ? ` — the glossary says use ${entry.replacements.map((r) => `"${r}"`).join(" or ")}`
          : entry.guidance
            ? ` — the glossary says: ${entry.guidance}`
            : "";
        out.push({
          validator: id,
          severity: "warning",
          file,
          line,
          rule: "banned-word",
          message: `line ${line} uses "${m[0].replace(/\s+/g, " ")}", a word this project does not use${says}`,
          hint: `See "${SECTION_HEADING}" in ${glossary}. If this is a legitimate sense, add an \`Except:\` clause to the entry naming the phrase as a code span.`,
        });
      }
    }
  }
  return out;
}
