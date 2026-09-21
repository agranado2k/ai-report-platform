import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cleanup, ctxFor } from "./helpers.mjs";

// The context's contract, as a seam: one error mode for `read`, and `kind`
// as the only way to tell a directory from a file. Validators used to wrap
// `read` in their own try/catch to make that distinction; these are the
// cases those wrappers existed for.

test("read returns the text of a file", () => {
  const ctx = ctxFor({ "a.md": "hello\n" });
  assert.equal(ctx.read("a.md"), "hello\n");
  cleanup(ctx);
});

test("read returns null for a missing path", () => {
  const ctx = ctxFor({});
  assert.equal(ctx.read("missing.md"), null);
  cleanup(ctx);
});

test("read returns null for a directory — it does not throw", () => {
  const ctx = ctxFor({ "dir/inner.md": "x\n" });
  assert.equal(ctx.read("dir"), null);
  cleanup(ctx);
});

test("kind says file, directory, or null", () => {
  const ctx = ctxFor({ "a.md": "hello\n", "dir/inner.md": "x\n" });
  assert.equal(ctx.kind("a.md"), "file");
  assert.equal(ctx.kind("dir"), "directory");
  assert.equal(ctx.kind("missing"), null);
  cleanup(ctx);
});

test("kind follows a symlink to what it resolves to, and a dangling one is null to kind and to read", () => {
  const ctx = ctxFor({ "real/SKILL.md": "# real\n" });
  mkdirSync(join(ctx.repoRoot, "links"), { recursive: true });
  symlinkSync("../real", join(ctx.repoRoot, "links/good"));
  symlinkSync("../nowhere", join(ctx.repoRoot, "links/dangling"));
  assert.equal(ctx.kind("links/good"), "directory");
  assert.equal(ctx.kind("links/dangling"), null);
  assert.equal(ctx.read("links/dangling"), null);
  cleanup(ctx);
});

test("a present file that cannot be read is a file to kind, not readable, and read THROWS — the gate must not pass it in silence", {
  skip: process.getuid?.() === 0 && "chmod does not restrain root",
}, () => {
  const ctx = ctxFor({ "locked.md": "secret\n" });
  chmodSync(join(ctx.repoRoot, "locked.md"), 0o000);
  try {
    assert.equal(ctx.kind("locked.md"), "file");
    assert.equal(ctx.readable("locked.md"), false);
    assert.throws(() => ctx.read("locked.md"), /EACCES/);
  } finally {
    chmodSync(join(ctx.repoRoot, "locked.md"), 0o644);
    cleanup(ctx);
  }
});

test("a FIFO is null to kind — nothing opens it, so nothing blocks on it", () => {
  const ctx = ctxFor({});
  try {
    execFileSync("mkfifo", [join(ctx.repoRoot, "pipe")]);
  } catch {
    cleanup(ctx);
    return; // no mkfifo on this machine: the case cannot be built here
  }
  assert.equal(ctx.kind("pipe"), null);
  cleanup(ctx);
});

test("the context exposes the kit's five plus this repo's two fork additions", () => {
  // The kit's context exposes exactly read, kind, readable, list and exists and
  // deliberately no recursive lister. This repo's context.mjs is a RECORDED LOCAL
  // FORK (see VERSION): the v0.20.0 context verbatim plus `listRecursive` (the
  // event-names validator walks packages/domain/src) and the `paths` map the
  // eight local docs-skeleton validators read. Anything else appearing here is
  // drift, in either direction.
  const ctx = ctxFor({});
  assert.deepEqual(Object.keys(ctx).sort(), [
    "config",
    "exists",
    "kind",
    "list",
    "listRecursive",
    "paths",
    "read",
    "readable",
    "repoRoot",
  ]);
  cleanup(ctx);
});
