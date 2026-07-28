// Covers the event-names validator's emit-site cross-check (truth-up of the
// event catalog): it greps `type: "EventName"` constructor sites in
// packages/domain/src and fails when an emitted event is undocumented, or
// when docs/events.md's "## Emitted" section claims an event that no code
// constructs.

import assert from "node:assert/strict";
import { test } from "node:test";
import defaultConfig from "../config.mjs";
import * as eventNames from "../validators/event-names.mjs";
import { cleanup, ctxFor, hasRule } from "./helpers.mjs";

const EVENTS_MD_HEADER = "docs/events.md";
const GLOSSARY_MD = "docs/domain-glossary.md";

/** Minimal glossary body that satisfies the pre-existing pinned-event check. */
function glossaryBody(names) {
  return names.join(", ");
}

test("event-names: a constructed event undocumented anywhere is flagged", () => {
  const config = { ...defaultConfig, events: ["ReportPublished"] };
  const ctx = ctxFor(
    {
      "packages/domain/src/report.ts": 'const e = {\n    type: "SomeNewEvent",\n  };',
      [EVENTS_MD_HEADER]: "## Emitted\n\n| Event |\n|---|\n| `ReportPublished` |\n",
      [GLOSSARY_MD]: glossaryBody(["ReportPublished"]),
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(hasRule(violations, "emitted-event-undocumented"));
  assert.ok(violations.some((v) => v.message.includes("SomeNewEvent")));
  cleanup(ctx);
});

test("event-names: a constructed event documented in the Emitted section passes", () => {
  const config = { ...defaultConfig, events: [] };
  const ctx = ctxFor(
    {
      "packages/domain/src/report.ts": 'const e = {\n    type: "ReportPublished",\n  };',
      [EVENTS_MD_HEADER]: "## Emitted\n\n| Event |\n|---|\n| `ReportPublished` |\n",
      [GLOSSARY_MD]: "n/a",
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(!hasRule(violations, "emitted-event-undocumented"));
  assert.ok(!hasRule(violations, "emitted-event-not-constructed"));
  cleanup(ctx);
});

test("event-names: a constructed event only in the pinned list (not docs) still passes (i)", () => {
  const config = { ...defaultConfig, events: ["ReportPublished"] };
  const ctx = ctxFor(
    {
      "packages/domain/src/report.ts": 'const e = {\n    type: "ReportPublished",\n  };',
      [EVENTS_MD_HEADER]: "## Emitted\n\n| Event |\n|---|\n",
      [GLOSSARY_MD]: glossaryBody(["ReportPublished"]),
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(!hasRule(violations, "emitted-event-undocumented"));
  cleanup(ctx);
});

test('event-names: declaring `readonly type: "X"` alone (interface field) is not treated as a construction site', () => {
  const config = { ...defaultConfig, events: [] };
  const ctx = ctxFor(
    {
      "packages/domain/src/events.ts": 'export interface Foo {\n  readonly type: "Foo";\n}',
      [EVENTS_MD_HEADER]: "## Emitted\n\n| Event |\n|---|\n",
      [GLOSSARY_MD]: "n/a",
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(!hasRule(violations, "emitted-event-undocumented"));
  cleanup(ctx);
});

test("event-names: an event listed as Emitted but never constructed is flagged", () => {
  const config = { ...defaultConfig, events: [] };
  const ctx = ctxFor(
    {
      "packages/domain/src/report.ts": 'const e = {\n    type: "ReportPublished",\n  };',
      [EVENTS_MD_HEADER]:
        "## Emitted\n\n| Event |\n|---|\n| `ReportPublished` |\n| `GhostEvent` |\n",
      [GLOSSARY_MD]: "n/a",
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(hasRule(violations, "emitted-event-not-constructed"));
  assert.ok(violations.some((v) => v.message.includes("GhostEvent")));
  // ReportPublished IS constructed, so it must not also be flagged.
  assert.ok(
    !violations.some(
      (v) => v.rule === "emitted-event-not-constructed" && v.message.includes("ReportPublished"),
    ),
  );
  cleanup(ctx);
});

test("event-names: an Emitter-column reference (e.g. a use-case name) is not mistaken for an event", () => {
  const config = { ...defaultConfig, events: [] };
  const ctx = ctxFor(
    {
      "packages/domain/src/report.ts": 'const e = {\n    type: "ReportPublished",\n  };',
      [EVENTS_MD_HEADER]:
        "## Emitted\n\n| Event | Emitter |\n|---|---|\n| `ReportPublished` | Reports (`PromoteVersionUseCase`) |\n",
      [GLOSSARY_MD]: "n/a",
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(!hasRule(violations, "emitted-event-not-constructed"));
  cleanup(ctx);
});

test("event-names: no packages/domain/src in the fixture skips the emit-site checks (back-compat)", () => {
  const config = { ...defaultConfig, events: ["ReportPublished"] };
  const ctx = ctxFor(
    {
      [EVENTS_MD_HEADER]: "ReportPublished happens on publish.",
      [GLOSSARY_MD]: "ReportPublished",
    },
    config,
  );
  const violations = eventNames.run(ctx);
  assert.ok(!hasRule(violations, "emitted-event-undocumented"));
  assert.ok(!hasRule(violations, "emitted-event-not-constructed"));
  cleanup(ctx);
});
