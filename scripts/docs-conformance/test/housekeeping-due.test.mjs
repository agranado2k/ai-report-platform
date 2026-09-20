import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import defaultConfig from "../config.mjs";
import { makeContext } from "../context.mjs";
import {
  DEFAULT_DIARY,
  DEFAULT_WINDOW_DAYS,
  ROW_LABEL,
  run,
} from "../validators/housekeeping-due.mjs";
import { cleanup, ctxFor, hasRule } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// The diary's Current state table, as bootstrap stamps it, with the row the
// 0.15.0 template adds. Dates are computed against the real clock, so the
// fixtures stay fresh or stale by construction rather than by calendar.
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
const diaryWith = (rowValue) =>
  [
    "# Development diary",
    "",
    "## Current state — 2026-01-01",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| **Phase** | Shipping. |",
    ...(rowValue == null ? [] : [`| **Last housekeeping** | ${rowValue} |`]),
    "| **Active worktrees** | None. |",
    "",
    "## Entries",
    "",
  ].join("\n");

const cfgWith = (housekeepingDue) => ({ ...defaultConfig, housekeepingDue });

test("a row dated today is silent", () => {
  const ctx = ctxFor({
    "docs/diary.md": diaryWith(`${iso(0)} — bootstrapped; first pass due in a month.`),
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a row inside the window is silent — the window is inclusive of its last day", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(iso(30)) });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("a row older than the window warns, naming the age and the window", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(`${iso(60)} — the pass found nothing.`) });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "housekeeping-due"));
  assert.equal(out[0].severity, "warning");
  assert.equal(out[0].file, "docs/diary.md");
  assert.match(out[0].message, /60 days/);
  assert.match(out[0].message, /30/);
  cleanup(ctx);
});

test("a missing row warns naming the row — and only warns", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(null) });
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.ok(hasRule(out, "housekeeping-row-missing"));
  assert.equal(out[0].severity, "warning");
  assert.match(out[0].message, /Last housekeeping/);
  cleanup(ctx);
});

test("a row with no ISO date is a missing row, not a fresh one", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith("soon") });
  assert.ok(hasRule(run(ctx), "housekeeping-row-missing"));
  cleanup(ctx);
});

test("the window is policy: a wider windowDays keeps an older row silent", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(iso(60)) }, cfgWith({ windowDays: 90 }));
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("the window is policy: a narrower windowDays makes a younger row warn", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(iso(10)) }, cfgWith({ windowDays: 7 }));
  const out = run(ctx);
  assert.ok(hasRule(out, "housekeeping-due"));
  assert.match(out[0].message, /10 days/);
  assert.match(out[0].message, /7/);
  cleanup(ctx);
});

test("the housekeepingDue.diary override points the rule at a different file", () => {
  const ctx = ctxFor({ "notes/log.md": diaryWith(null) }, cfgWith({ diary: "notes/log.md" }));
  const out = run(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "notes/log.md");
  cleanup(ctx);
});

test("a row only inside a fenced code block is quoted material, not a date", () => {
  const ctx = ctxFor({
    "docs/diary.md": [
      "# Development diary",
      "",
      "```md",
      `| **Last housekeeping** | ${iso(0)} |`,
      "```",
      "",
      "No row of our own.",
      "",
    ].join("\n"),
  });
  assert.ok(hasRule(run(ctx), "housekeeping-row-missing"));
  cleanup(ctx);
});

test("no diary, no finding — a tree without one is not this rule's business", () => {
  const ctx = ctxFor({ "AGENTS.md": "# Manual\n" });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("the defaults hold with no housekeepingDue section in the config at all", () => {
  // The code path every consumer takes at first contact: their config.mjs
  // predates the section. The validator must read the diary at its default
  // path with the default window rather than crash or go silent.
  const { housekeepingDue, ...withoutSection } = defaultConfig;
  assert.ok(housekeepingDue, "the shipped config carries the section this test removes");
  assert.equal(DEFAULT_DIARY, "docs/diary.md");
  assert.equal(DEFAULT_WINDOW_DAYS, 30);
  const stale = ctxFor(
    { [DEFAULT_DIARY]: diaryWith(iso(DEFAULT_WINDOW_DAYS + 1)) },
    withoutSection,
  );
  const out = run(stale);
  assert.ok(hasRule(out, "housekeeping-due"));
  assert.match(out[0].message, new RegExp(`${DEFAULT_WINDOW_DAYS} days`));
  cleanup(stale);
  const fresh = ctxFor({ [DEFAULT_DIARY]: diaryWith(iso(DEFAULT_WINDOW_DAYS)) }, withoutSection);
  assert.deepEqual(run(fresh), []);
  cleanup(fresh);
});

test("a compact row — no space before the closing pipe — reads the same as a spaced one", () => {
  const ctx = ctxFor({
    "docs/diary.md": diaryWith(null).replace(
      "| **Active worktrees** |",
      `| **${ROW_LABEL}** |${iso(0)}|\n| **Active worktrees** |`,
    ),
  });
  assert.deepEqual(run(ctx), []);
  cleanup(ctx);
});

test("an ISO-shaped date that is not a date is a missing row, never 'NaN days ago'", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith("2026-13-45 — typo") });
  const out = run(ctx);
  assert.ok(hasRule(out, "housekeeping-row-missing"));
  assert.doesNotMatch(out[0].message, /NaN/);
  cleanup(ctx);
});

test("a future-dated row is malformed, not fresh — it would silence the nudge forever", () => {
  const ctx = ctxFor({ "docs/diary.md": diaryWith(iso(-1)) });
  const out = run(ctx);
  assert.ok(hasRule(out, "housekeeping-row-missing"));
  assert.match(out[0].message, /future/);
  cleanup(ctx);
});

test("this repo's diary carries the row — its freshness is the advisory channel's business, never this suite's", () => {
  // Asserting freshness here would turn a deliberately never-failing advisory
  // into a CI failure on a calendar date. The shape is what the suite holds.
  const ctx = makeContext({ repoRoot: join(here, "..", "..", ".."), config: defaultConfig });
  assert.ok(
    !hasRule(run(ctx), "housekeeping-row-missing"),
    "the kit's diary has no valid Last housekeeping row",
  );
});

// NOTE (centaur-spec local deviation): the kit's "end to end … gate still exits
// 0" test is intentionally omitted — it spawns the full index.mjs against a BARE
// fixture and asserts exit 0, which holds only for the kit's eight-validator
// runner. This repo's runner.mjs (a recorded fork, see VERSION) registers sixteen
// validators, so a bare fixture correctly exits 1 on the eight local
// docs-skeleton validators. The unit tests above cover the rule; `pnpm docs:check` proves the green case on the
// real tree.
