import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Build the read-only context every validator receives. Rooted at `repoRoot`
 * so tests can point it at a fixture tree instead of the real repo.
 *
 * ONE ANSWER TO "IS THERE A BODY?": `read` returns null when there is nothing
 * to read — missing, a directory, a dangling symlink — because that is the
 * one question a validator has, and it used to answer it with a try/catch of
 * its own around a wrapper that leaked errno codes. A body that EXISTS and
 * cannot be read (permissions, I/O) still throws: the runner reports that as
 * a violation, and a gate that turned an unreadable manual into a green pass
 * would be the silent swallow this seam exists to end. A validator that must
 * tell a directory from a file asks `kind`; one that must report an
 * unreadable body itself, rather than crash on it, asks `readable` first.
 *
 * LOCAL FORK (centaur-spec, recorded in VERSION): the kit's v0.20.0 context
 * VERBATIM plus two local additions the eight docs-skeleton validators read —
 * `listRecursive` (event-names walks packages/domain/src) and the `paths` map
 * on the returned ctx. read/kind/readable/list/exists are unchanged, so the
 * shared validators run against it untouched. The kit deliberately ships no
 * `paths` map (every path is policy in config.mjs); ours stays until the kit
 * upstreams the docs-skeleton validators, at which point this fork retires.
 *
 * @param {{ repoRoot: string, config: object }} opts
 */
export function makeContext({ repoRoot, config }) {
  /** The text of a repo-relative file; null when nothing is there to read. Throws when a body exists and cannot be read. */
  const read = (rel) => {
    try {
      return readFileSync(join(repoRoot, rel), "utf8");
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "EISDIR" || err?.code === "ENOTDIR") return null;
      throw err;
    }
  };

  /**
   * "file", "directory", or null. Symlinks are followed (a link to a
   * directory is a directory; a dangling link is null), and anything that is
   * neither a regular file nor a directory — a FIFO, a socket, a device — is
   * null too, so no validator ever opens one and blocks the gate on it.
   */
  const kind = (rel) => {
    try {
      const st = statSync(join(repoRoot, rel));
      return st.isDirectory() ? "directory" : st.isFile() ? "file" : null;
    } catch {
      return null;
    }
  };

  /** Whether a present path can be read by this process. */
  const readable = (rel) => {
    try {
      accessSync(join(repoRoot, rel), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  };

  /** List file names in a repo-relative dir, optionally filtered by extension. */
  const list = (relDir, ext) => {
    const p = join(repoRoot, relDir);
    if (!existsSync(p)) return [];
    return readdirSync(p)
      .filter((f) => !ext || f.endsWith(ext))
      .sort();
  };

  /**
   * LOCAL: list repo-relative file paths under a dir, recursing into
   * subdirectories, optionally filtered by extension. Returns `[]` if the dir
   * doesn't exist — validators that use this can stay silent on fixtures that
   * don't model it.
   */
  const listRecursive = (relDir, ext) => {
    const root = join(repoRoot, relDir);
    if (!existsSync(root)) return [];
    const out = [];
    const walk = (dir, relBase) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        const rel = relBase ? join(relBase, entry.name) : entry.name;
        if (entry.isDirectory()) {
          walk(abs, rel);
        } else if (!ext || entry.name.endsWith(ext)) {
          out.push(join(relDir, rel));
        }
      }
    };
    walk(root, "");
    return out.sort();
  };

  const exists = (rel) => existsSync(join(repoRoot, rel));

  return {
    repoRoot,
    config,
    read,
    kind,
    readable,
    list,
    listRecursive,
    exists,
    // LOCAL: well-known project locations the eight local validators read.
    paths: {
      docs: "docs",
      adrDir: "docs/adr",
      adrIndex: "docs/adr/INDEX.md",
      glossary: "docs/domain-glossary.md",
      events: "docs/events.md",
      contextMap: "docs/context-map.md",
      features: "tests/e2e/features",
      openapi: "docs/api/openapi.yaml",
      domainSrc: "packages/domain/src",
    },
  };
}
