// Validates a bijection between ADR files on disk and rows in INDEX.md:
// every ADR file is linked from the index, and every linked file exists.

export const id = "adr-index-sync";

export function run(ctx) {
  const out = [];
  const index = ctx.read(ctx.paths.adrIndex);
  if (index == null) {
    out.push({
      validator: id,
      file: ctx.paths.adrIndex,
      rule: "index-missing",
      message: "docs/adr/INDEX.md does not exist",
      hint: "Create the ADR registry.",
    });
    return out;
  }

  const linked = new Set();
  const linkRe = /\[[^\]]+\]\((\d{4}-[a-z0-9-]+\.md)\)/g;
  for (const m of index.matchAll(linkRe)) linked.add(m[1]);

  const actual = new Set(ctx.list(ctx.paths.adrDir, ".md").filter((f) => f !== "INDEX.md"));

  for (const f of actual) {
    if (!linked.has(f)) {
      out.push({
        validator: id,
        file: ctx.paths.adrIndex,
        rule: "adr-not-in-index",
        message: `ADR file "${f}" has no row in INDEX.md`,
        hint: "Add a table row linking to it.",
      });
    }
  }
  for (const f of linked) {
    if (!actual.has(f)) {
      out.push({
        validator: id,
        file: ctx.paths.adrIndex,
        rule: "index-dangling-link",
        message: `INDEX.md links "${f}" but the file does not exist`,
        hint: "Create the file or remove the row.",
      });
    }
  }

  return out;
}
