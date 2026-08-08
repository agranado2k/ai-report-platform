// CLAUDE.md is the agent operating manual, loaded into every session. A
// command or script it references but that does not exist is worse than no
// documentation: stale standing instructions actively poison agent context
// (plan Phase 1.2 — the "process docs are executable or CI-verified" rule).
//
// Three reference kinds are checked. Two are extracted from code spans:
//   - slash commands (`/tdd`) must resolve to .claude/skills/<name>/SKILL.md,
//     unless listed in config.claudeMdRefs.ignoreCommands (built-ins etc.);
//   - repo paths must exist on disk (see "path resolution" below).
// The third is reachability: every article must be referenced from the root.
//
// The manual is LAYERED (ADR-0082), and every layer is checked:
//   - the root CLAUDE.md;
//   - the on-demand articles under .claude/constitution/ — an agent loads one
//     and obeys it, so a stale command there poisons context exactly as the
//     root would. Checking only the root would leave the layer the restructure
//     moved most of the prose into completely unguarded;
//   - the nested package manuals named in config.claudeMdRefs.nestedManuals,
//     which Claude Code loads when an agent works in that tree.
//
// Reachability closes the other half of the article hole. Progressive
// disclosure means an article is loaded only because the root pointed at it, so
// an article the root never names is dead text: it binds nobody, and it drifts
// unnoticed because nothing reads it. One home per rule requires exactly one
// door in. Nested manuals are exempt — nothing has to point at them to make
// them load.
//
// PATH RESOLUTION (the rule itself is policy, and lives in config):
// a token whose first segment is one of config.claudeMdRefs.pathRoots resolves
// repo-relative from any manual; every other path-shaped token inside a NESTED
// manual resolves against that manual's own directory. So `tests/evals/` in
// apps/mcp/CLAUDE.md is the repo's eval suite, while `src/tools.ts` is
// apps/mcp/src/tools.ts. Repo-level manuals never resolve package-relative.
//
// Finally, the shared article carries an extra obligation the others don't: it
// must stay copyable verbatim into another repo. `portability-leak` enforces
// the deny-list in config.claudeMdRefs.portability.

export const id = "claude-md-refs";

const ROOT_MANUAL = "CLAUDE.md";
const CONSTITUTION_DIR = ".claude/constitution";
const MANUAL_FILE = "CLAUDE.md";

// A slash command is a single-segment, kebab-case token: `/tdd`, `/grill-me`.
// Multi-segment spans (`/api/v1/reports`) are URLs/paths, not commands. Only
// spans that OPEN with a slash command are command-bearing — that keeps shell
// snippets (`rm -rf /tmp`) from being misread as command references — and in a
// command-bearing span every /-token is checked (`/loop /pr-iterate <PR#>`).
//
// Both patterns tolerate adjacent punctuation, which they previously did not:
// a span was command-bearing only if its very first character was `/`, and a
// token counted only when flanked by whitespace. `` `/tdd.` `` and
// `` `/loop (/pr-iterate)` `` therefore passed silently — the worst failure
// mode for a guard, since a dead reference reads as a checked one.
const COMMAND_SPAN = /^[([{"']?\/[a-z]/;
const COMMAND_TOKEN = /(?:^|[\s([{"'|])\/([a-z][a-z0-9-]*)(?=$|[\s)\]}"'|,.;:!?])/g;

// Inside a nested manual, a token that is not repo-anchored is package-relative
// — but only if it is unambiguously path-shaped: it must contain a `/` and
// either end in `/` (a directory) or carry a dotted final segment (a file).
// That keeps `src/tools.ts` and `packaging/` checked while leaving bare
// filenames (`server.test.ts`), globs (`*.test.ts`) and identifiers alone.
//
// `@` is admitted for symmetry with the portability deny-list's `repo-path`
// regex, which already accepts it: without it `@internal/foo/bar.ts` was a path
// to one guard and invisible to the other, so a dead scoped reference in a
// nested manual went unchecked. A bare package specifier (`@scope/name`) is
// still not a path — the dotted-final-segment rule below sees to that.
const PKG_RELATIVE = /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/;

export function run(ctx) {
  const cfg = ctx.config.claudeMdRefs ?? {};
  const pathRe = pathTokenRe(cfg.pathRoots ?? []);

  const articles = ctx.list(CONSTITUTION_DIR, ".md").map((name) => `${CONSTITUTION_DIR}/${name}`);
  const nested = (cfg.nestedManuals ?? []).map((entry) => entry.dir);

  // The root first, then each article, then the nested manuals — so a run's
  // violations read top-down through the layers the way an agent loads them.
  const manuals = [
    { file: ROOT_MANUAL, base: "" },
    ...articles.map((file) => ({ file, base: "" })),
    ...nested.map((dir) => ({ file: `${dir}/${MANUAL_FILE}`, base: dir })),
  ];

  const out = manuals.flatMap(({ file, base }) => checkOne(ctx, file, base, pathRe));

  for (const file of cfg.portability?.files ?? []) {
    out.push(...checkPortability(ctx, file, cfg.portability.deny ?? []));
  }

  // Reachability is only a question when there IS a root to be reached from —
  // fixtures that model articles alone stay silent, as they do for the root.
  const root = ctx.read(ROOT_MANUAL);
  if (root == null) return out;
  const referenced = extractRefs(root, pathRe, "").paths;
  for (const article of articles) {
    if (referenced.has(article)) continue;
    out.push({
      validator: id,
      file: article,
      rule: "article-unreferenced",
      message: `is not referenced from ${ROOT_MANUAL} — no agent will ever be pointed at it`,
      hint: `Add a pointer to it in ${ROOT_MANUAL}'s article layer, or delete the article — an unreachable standing instruction binds nobody and drifts unnoticed.`,
    });
  }

  return out;
}

/** Build the repo-anchored path matcher from the configured roots. */
function pathTokenRe(roots) {
  if (roots.length === 0) return /(?!)/;
  const alt = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(?:${alt})/[\\w./-]+$`);
}

/**
 * Markdown code spans, CommonMark-style: a run of N backticks opens a span and
 * the next run of EXACTLY N closes it.
 *
 * The previous single-backtick pair regex could not see a doubled span at all.
 * That matters because a manual reaches for `` `` `` precisely to quote text
 * that contains backticks — `` `/tdd` `` — so the pairing landed on the padding
 * spaces and the command inside was invisible. The most deliberately-written
 * references were the ones the guard skipped.
 *
 * An unterminated opener is skipped rather than allowed to swallow the rest of
 * the document, so one stray backtick cannot blind the whole run.
 */
function codeSpans(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === "`") n++;
    const open = i + n;
    let j = open;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (text[j + m] === "`") m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) {
      i = open;
      continue;
    }
    out.push(normalizeSpan(text.slice(open, close)));
    i = close + n;
  }
  return out;
}

/**
 * CommonMark strips one leading and one trailing space when both are present
 * and the content is not all spaces — that padding is exactly how a doubled
 * span quotes a backtick. The inner backticks are then unwrapped too, so
 * `` `/tdd` `` yields the same token a plain `/tdd` span would.
 */
function normalizeSpan(raw) {
  const padded =
    raw.length > 1 && raw.startsWith(" ") && raw.endsWith(" ") && raw.trim() !== ""
      ? raw.slice(1, -1)
      : raw;
  return padded.replace(/^`+|`+$/g, "");
}

/**
 * Strip fenced code blocks. A fence's own markers (``` = three backticks) would
 * otherwise be read as a code-span delimiter run. `~~~` fences get the same
 * treatment — a manual reaches for `~~~` precisely to show a ``` fence
 * verbatim, which is the case that leaves stray backticks behind. Fences may be
 * indented (lists), so anchor on optional leading whitespace.
 */
function stripFences(raw) {
  return raw.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");
}

/**
 * Extract the executable references from one manual's prose.
 *
 * `base` is the manual's own directory (empty for the root and the articles).
 * Paths come back as a Map of token-as-written → repo-relative path, so a
 * violation can show both the reference and where it resolved to.
 */
function extractRefs(raw, pathRe, base) {
  const commands = new Set();
  const paths = new Map();
  for (const text of codeSpans(stripFences(raw))) {
    if (pathRe.test(text)) {
      paths.set(text, text);
    } else if (base && isPackageRelative(text)) {
      paths.set(text, `${base}/${text}`);
    }
    if (!COMMAND_SPAN.test(text)) continue;
    for (const m of text.matchAll(COMMAND_TOKEN)) commands.add(m[1]);
  }
  return { commands, paths };
}

function isPackageRelative(token) {
  if (!token.includes("/") || !PKG_RELATIVE.test(token)) return false;
  if (token.endsWith("/")) return true;
  return token.slice(token.lastIndexOf("/") + 1).includes(".");
}

/** Check one manual file (the root, an article, or a nested package manual). */
function checkOne(ctx, file, base, pathRe) {
  const out = [];
  const raw = ctx.read(file);
  if (raw == null) return out; // fixtures (and repos) that don't model this manual
  const ignore = new Set(ctx.config.claudeMdRefs?.ignoreCommands ?? []);

  const { commands, paths } = extractRefs(raw, pathRe, base);

  for (const name of [...commands].sort()) {
    if (ignore.has(`/${name}`)) continue;
    if (!ctx.exists(`.claude/skills/${name}/SKILL.md`)) {
      out.push({
        validator: id,
        file,
        rule: "skill-missing",
        message: `references \`/${name}\` but .claude/skills/${name}/SKILL.md does not exist`,
        hint: "Create the skill, remove the reference, or add it to claudeMdRefs.ignoreCommands with a reason.",
      });
    }
  }

  for (const [token, resolved] of [...paths].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (ctx.exists(resolved)) continue;
    out.push({
      validator: id,
      file,
      rule: "path-missing",
      message:
        token === resolved
          ? `references \`${token}\` but the file does not exist`
          : `references \`${token}\`, which resolves to ${resolved} — that file does not exist`,
      hint:
        token === resolved
          ? "Create the file or remove the reference — the manual must describe reality."
          : `A nested manual resolves non-repo-rooted paths against its own directory (${base}/). Use a repo-rooted path if you meant the repo-level file.`,
    });
  }

  return out;
}

/**
 * The shared article must stay copyable verbatim into another repo (ADR-0082).
 * Portability is a separate axis from existence: a path that resolves and a
 * command that exists are still leaks here, because the copy lands somewhere
 * that has neither.
 */
function checkPortability(ctx, file, deny) {
  const raw = ctx.read(file);
  if (raw == null) return [];
  const spans = codeSpans(stripFences(raw));
  const out = [];

  for (const entry of deny) {
    const targets = entry.scope === "spans" ? spans : [raw];
    const rx = withGlobalFlag(entry.re);
    const seen = new Set();
    for (const target of targets) {
      for (const match of target.matchAll(rx)) {
        const hit = match[0].trim();
        if (!hit || seen.has(hit)) continue;
        seen.add(hit);
        out.push({
          validator: id,
          file,
          rule: "portability-leak",
          message: `names "${hit}" (${entry.id}) — this article must be copyable verbatim into another repo`,
          hint: entry.reason,
        });
      }
    }
  }

  return out;
}

function withGlobalFlag(re) {
  return re.flags.includes("g") ? re : new RegExp(re.source, `${re.flags}g`);
}
