// Validates that every canonical domain event is referenced in both language
// sources of truth — docs/events.md and docs/domain-glossary.md — so the event
// contract has exactly one spelling everywhere it is named. Also cross-checks
// docs/events.md's "## Emitted" section against what packages/domain/src
// actually constructs (`type: "EventName"` sites), so the Emitted/Proposed
// split can't silently drift from the code (architecture-review candidate 7B —
// "truth-up the event catalog").

export const id = "event-names";

// Matches a `type: "EventName"` construction site. Declarations of the
// DomainEvent union's discriminant (`readonly type: "EventName";`) are
// excluded by the caller filtering out lines that contain "readonly" first —
// this pattern only runs against the remaining lines.
const CONSTRUCTOR_RE = /type:\s*"([A-Za-z]+)"/g;

// Matches the first (Event) column of a catalog table row, e.g.
// "| `ReportPublished` | Reports & Folders (`SomeUseCase`) | ... |" — anchored
// so a `` `UseCaseName` `` reference in a later column is never picked up.
const TABLE_EVENT_COLUMN_RE = /^\|\s*`([A-Za-z]+)`\s*\|/;

/** Every event name actually constructed in packages/domain/src (excluding test files). */
function findConstructedEvents(ctx) {
  const files = (ctx.listRecursive?.(ctx.paths.domainSrc, ".ts") ?? []).filter(
    (f) => !f.includes(".test."),
  );
  const found = new Set();
  for (const file of files) {
    const text = ctx.read(file) ?? "";
    for (const line of text.split("\n")) {
      if (line.includes("readonly")) continue; // interface field declaration, not a construction
      for (const m of line.matchAll(CONSTRUCTOR_RE)) found.add(m[1]);
    }
  }
  return found;
}

/** The lines of the named `## Heading` section (up to the next `##`), or null if absent. */
function extractSection(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/** Event names named in a catalog table's Event column within `## Emitted`. */
function findDocumentedEmitted(eventsText) {
  const section = extractSection(eventsText, "## Emitted");
  if (section === null) return null;
  const found = new Set();
  for (const line of section) {
    const m = TABLE_EVENT_COLUMN_RE.exec(line);
    if (m) found.add(m[1]);
  }
  return found;
}

export function run(ctx) {
  const out = [];
  const targets = [ctx.paths.events, ctx.paths.glossary];
  const texts = Object.fromEntries(targets.map((t) => [t, ctx.read(t) ?? ""]));

  for (const event of ctx.config.events) {
    for (const t of targets) {
      if (!texts[t].includes(event)) {
        out.push({
          validator: id,
          file: t,
          rule: "event-missing",
          message: `Canonical event "${event}" is not referenced in ${t}`,
          hint: "Every canonical domain event must appear in events.md and the glossary.",
        });
      }
    }
  }

  const eventsText = texts[ctx.paths.events];
  const documentedEmitted = findDocumentedEmitted(eventsText); // Set | null
  const constructed = findConstructedEvents(ctx);
  const pinned = new Set(ctx.config.events);

  // (i) A constructed event must appear in the Emitted section or the pinned
  // canonical list — otherwise it shipped without truthing up the catalog.
  for (const name of constructed) {
    const inDocs = documentedEmitted ? documentedEmitted.has(name) : eventsText.includes(name);
    if (!inDocs && !pinned.has(name)) {
      out.push({
        validator: id,
        file: ctx.paths.events,
        rule: "emitted-event-undocumented",
        message: `"${name}" is constructed in ${ctx.paths.domainSrc} but is missing from ${ctx.paths.events}'s Emitted section and the pinned canonical list`,
        hint: `Add "${name}" to the Emitted table in ${ctx.paths.events} (and to config.mjs's events list if it should be pinned).`,
      });
    }
  }

  // (ii) An event documented as Emitted must actually be constructed —
  // otherwise it belongs in "Proposed (not yet emitted)" instead.
  if (documentedEmitted) {
    for (const name of documentedEmitted) {
      if (!constructed.has(name)) {
        out.push({
          validator: id,
          file: ctx.paths.events,
          rule: "emitted-event-not-constructed",
          message: `"${name}" is listed in ${ctx.paths.events}'s Emitted section but is never constructed in ${ctx.paths.domainSrc}`,
          hint: `Move "${name}" to the "Proposed (not yet emitted)" section, or add its \`type: "${name}"\` construction site.`,
        });
      }
    }
  }

  return out;
}
