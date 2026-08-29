// The agent manual is loaded into every session, so a command or a path it
// names but that does not exist is worse than no documentation at all: stale
// standing instructions actively poison the context of every agent that reads
// them (shared invariant §8, and §11 on the context budget).
//
// Three reference kinds are checked. Two are extracted from code spans:
//   - slash commands (`/tdd`) must resolve to <skillsDir>/<name>/SKILL.md,
//     unless listed in config.claudeMdRefs.ignoreCommands (built-ins etc.);
//   - repo paths must exist on disk (see "path resolution" below).
// The third is reachability: every article must be referenced from the root.
//
// The manual is LAYERED, and every layer is checked:
//   - the root manual (config.claudeMdRefs.rootManual, default `AGENTS.md`);
//   - the on-demand articles under config.claudeMdRefs.constitutionDir — an
//     agent loads one and obeys it, so a stale command there poisons context
//     exactly as the root would. Checking only the root would leave the layer
//     that holds most of the prose completely unguarded;
//   - the nested package manuals named in config.claudeMdRefs.nestedManuals,
//     which an agent loads when it works in that tree. They carry the same
//     filename as the root manual, because "what the manual is called" is one
//     decision, not one per directory.
//
// Beside the manual sit the SHIMS (config.claudeMdRefs.shims): the entry points
// other agent tools look for. Each must hold nothing but an import of the root
// manual, plus at most one comment line saying that is all it is. `shim-invalid`
// is the fourth rule, and the reason it exists is drift: a tool-specific file
// that CAN hold a rule eventually does, and then the repo has two manuals whose
// difference nobody can see. Like every other check here it is evaluated only
// where the root manual exists — a tree whose manual has not been written yet
// has no shims to be wrong about either.
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
// repo-relative, from any manual; every other path-shaped token inside a NESTED
// manual resolves against that manual's own directory. So `tests/` named in
// `apps/api/AGENTS.md` is the repo's test tree, while `src/tools.ts` is
// `apps/api/src/tools.ts`. Repo-level manuals never resolve package-relative.
//
// Finally, the shared article carries an extra obligation the others don't: it
// must stay copyable verbatim into another repo. `portability-leak` enforces
// the deny-list in config.claudeMdRefs.portability.

export const id = "claude-md-refs";

const DEFAULT_ROOT_MANUAL = "AGENTS.md";
const DEFAULT_CONSTITUTION_DIR = ".claude/constitution";
const DEFAULT_SKILLS_DIR = ".claude/skills";

// A shim's two legal line shapes. The import is the line the tool resolves; the
// comment is an HTML comment, which renders as nothing and therefore cannot be
// read as a rule — the distinction the whole rule rests on. Anything else,
// including a markdown heading or a second import, is content.
const SHIM_COMMENT = /^<!--[\s\S]*-->$/;
const shimImportRe = (manual) => new RegExp(`^@${manual.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

// A slash command is a single-segment, kebab-case token: `/tdd`, `/grill-me`.
// Multi-segment spans (`/api/v1/reports`) are URLs/paths, not commands. Only
// spans that OPEN with a slash command are command-bearing — that keeps shell
// snippets (`rm -rf /tmp`) from being misread as command references — and in a
// command-bearing span every /-token is checked (`/loop /pr-iterate <PR#>`).
//
// Both patterns tolerate adjacent punctuation. Without that, a span counted as
// command-bearing only if its very first character was `/`, and a token counted
// only when flanked by whitespace: `` `/tdd.` `` and `` `/loop (/pr-iterate)` ``
// passed silently — the worst failure mode for a guard, since a dead reference
// then reads as a checked one.
const COMMAND_SPAN = /^[([{"']?\/[a-z]/;
const COMMAND_TOKEN = /(?:^|[\s([{"'|])\/([a-z][a-z0-9-]*)(?=$|[\s)\]}"'|,.;:!?])/g;

// Inside a nested manual, a token that is not repo-anchored is package-relative
// — but only if it is unambiguously path-shaped: it must contain a `/` and
// either end in `/` (a directory) or carry a dotted final segment (a file).
// That keeps `src/tools.ts` and `packaging/` checked while leaving bare
// filenames (`server.test.ts`), globs (`*.test.ts`) and identifiers alone.
//
// `@` is admitted for symmetry with the portability deny-list's `repo-path`
// regex, which already accepts it: without it, `@internal/foo/bar.ts` was a
// path to one guard and invisible to the other, so a dead scoped reference in a
// nested manual went unchecked. A bare package specifier (`@scope/name`) is
// still not a path — the dotted-final-segment rule below sees to that.
const PKG_RELATIVE = /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/;

export function run(ctx) {
  const cfg = ctx.config.claudeMdRefs ?? {};
  const rootManual = cfg.rootManual ?? DEFAULT_ROOT_MANUAL;
  const constitutionDir = cfg.constitutionDir ?? DEFAULT_CONSTITUTION_DIR;
  const pathRe = pathTokenRe(cfg.pathRoots ?? []);

  const articles = ctx.list(constitutionDir, ".md").map((name) => `${constitutionDir}/${name}`);
  const nested = (cfg.nestedManuals ?? []).map((entry) => entry.dir);

  // The root first, then each article, then the nested manuals — so a run's
  // violations read top-down through the layers the way an agent loads them.
  const manuals = [
    { file: rootManual, base: "" },
    ...articles.map((file) => ({ file, base: "" })),
    ...nested.map((dir) => ({ file: `${dir}/${rootManual}`, base: dir })),
  ];

  const out = manuals.flatMap(({ file, base }) => checkOne(ctx, file, base, pathRe));

  for (const file of cfg.portability?.files ?? []) {
    out.push(...checkPortability(ctx, file, cfg.portability.deny ?? []));
  }

  // Everything below needs a root manual to exist. Reachability is only a
  // question when there IS a root to be reached from, and a shim is only wrong
  // when there is a manual for it to have failed to import — fixtures that
  // model articles alone, and a tree whose manual is not written yet, stay
  // silent.
  const root = ctx.read(rootManual);
  if (root == null) return out;

  out.push(...checkShims(ctx, cfg.shims ?? [], rootManual));

  const referenced = extractRefs(root, pathRe, "").paths;
  for (const article of articles) {
    if (referenced.has(article)) continue;
    out.push({
      validator: id,
      file: article,
      rule: "article-unreferenced",
      message: `is not referenced from ${rootManual} — no agent will ever be pointed at it`,
      hint: `Add a pointer to it in ${rootManual}'s article layer, or delete the article — an unreachable standing instruction binds nobody and drifts unnoticed.`,
    });
  }

  return out;
}

/** Build the repo-anchored path matcher from the configured roots. */
// Exported alongside commandRefs below, and for the same reason: the
// skill-paths validator must ask "what counts as a repo-path reference?" and
// get THIS answer, not a re-derivation of it.
export function pathTokenRe(roots) {
  if (roots.length === 0) return /(?!)/;
  const alt = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(?:${alt})/[\\w./-]+$`);
}

/**
 * The repo-path extraction alone — code spans only, fences stripped, no
 * package-relative resolution (skills are repo-level documents, like the root
 * manual and the articles: they have no package to be relative to).
 */
export function pathRefs(raw, pathRe) {
  const paths = new Set();
  for (const text of codeSpans(stripFences(raw))) {
    if (pathRe.test(text)) paths.add(text);
  }
  return paths;
}

/**
 * Markdown code spans, CommonMark-style: a run of N backticks opens a span and
 * the next run of EXACTLY N closes it.
 *
 * A single-backtick pair regex cannot see a doubled span at all. That matters
 * because a manual reaches for `` `` `` precisely to quote text that contains
 * backticks — `` `/tdd` `` — so the pairing lands on the padding spaces and the
 * command inside is invisible. The most deliberately-written references would
 * be the ones the guard skipped.
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
  const commands = commandRefs(raw);
  const paths = new Map();
  for (const text of codeSpans(stripFences(raw))) {
    if (pathRe.test(text)) {
      paths.set(text, text);
    } else if (base && isPackageRelative(text)) {
      paths.set(text, `${base}/${text}`);
    }
  }
  return { commands, paths };
}

/**
 * The slash-command extraction alone, exported so the skill-web validator
 * reads references with the SAME grammar this manual validator uses — one
 * definition of "what is a command reference", two consumers.
 */
export function commandRefs(raw) {
  const commands = new Set();
  for (const text of codeSpans(stripFences(raw))) {
    if (!COMMAND_SPAN.test(text)) continue;
    for (const m of text.matchAll(COMMAND_TOKEN)) commands.add(m[1]);
  }
  return commands;
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
  const cfg = ctx.config.claudeMdRefs ?? {};
  const skillsDir = cfg.skillsDir ?? DEFAULT_SKILLS_DIR;
  const ignore = new Set(cfg.ignoreCommands ?? []);

  const { commands, paths } = extractRefs(raw, pathRe, base);

  for (const name of [...commands].sort()) {
    if (ignore.has(`/${name}`)) continue;
    if (!ctx.exists(`${skillsDir}/${name}/SKILL.md`)) {
      out.push({
        validator: id,
        file,
        rule: "skill-missing",
        message: `references \`/${name}\` but ${skillsDir}/${name}/SKILL.md does not exist`,
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
 * The tool shims must stay shims.
 *
 * Legal content, after blank lines are dropped: exactly one import line
 * (`@<rootManual>`), and at most one HTML-comment line saying that is all the
 * file is. That is the whole grammar, and it is deliberately unforgiving —
 * "nothing but an import" is only checkable if there is no room to argue about
 * what else counts as nothing.
 *
 * Called only when the root manual exists (see `run`), so a missing shim is
 * reported as a real failure rather than as "this tree has no manual layer".
 */
function checkShims(ctx, shims, rootManual) {
  const out = [];
  const importRe = shimImportRe(rootManual);

  for (const file of shims) {
    const raw = ctx.read(file);
    if (raw == null) {
      out.push({
        validator: id,
        file,
        rule: "shim-invalid",
        message: `is listed as a shim for ${rootManual} but does not exist — that agent tool loads no manual at all`,
        hint: `Create it containing exactly \`@${rootManual}\`, or drop it from claudeMdRefs.shims if you do not want that entry point.`,
      });
      continue;
    }

    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const imports = lines.filter((l) => importRe.test(l));
    const extra = lines.filter((l) => !importRe.test(l) && !SHIM_COMMENT.test(l));
    const comments = lines.filter((l) => SHIM_COMMENT.test(l));

    if (imports.length !== 1 || extra.length > 0 || comments.length > 1) {
      out.push({
        validator: id,
        file,
        rule: "shim-invalid",
        message:
          imports.length === 0
            ? `is a shim for ${rootManual} but never imports it`
            : `is a shim for ${rootManual} but carries content of its own`,
        hint: `A shim holds one line — \`@${rootManual}\` — plus at most one comment saying so. Rules belong in ${rootManual}; a shim that can hold one becomes a second manual nobody diffs.`,
      });
    }
  }

  return out;
}

/**
 * The shared article must stay copyable verbatim into another repo — that is
 * the whole reason it is a separate file. Portability is a separate axis from
 * existence: a path that resolves and a command that exists are still leaks
 * here, because the copy lands somewhere that has neither.
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
