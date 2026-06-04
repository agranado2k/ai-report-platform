import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build the read-only context every validator receives. Rooted at `repoRoot`
 * so tests can point it at a fixture tree instead of the real repo.
 *
 * @param {{ repoRoot: string, config: object }} opts
 */
export function makeContext({ repoRoot, config }) {
  /** Read a repo-relative file, or null if it does not exist. */
  const read = (rel) => {
    const p = join(repoRoot, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };

  /** List file names in a repo-relative dir, optionally filtered by extension. */
  const list = (relDir, ext) => {
    const p = join(repoRoot, relDir);
    if (!existsSync(p)) return [];
    return readdirSync(p)
      .filter((f) => !ext || f.endsWith(ext))
      .sort();
  };

  const exists = (rel) => existsSync(join(repoRoot, rel));

  return {
    repoRoot,
    config,
    read,
    list,
    exists,
    paths: {
      docs: "docs",
      adrDir: "docs/adr",
      adrIndex: "docs/adr/INDEX.md",
      glossary: "docs/domain-glossary.md",
      events: "docs/events.md",
      contextMap: "docs/context-map.md",
      features: "tests/e2e/features",
      openapi: "docs/api/openapi.yaml",
    },
  };
}
