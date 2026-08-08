// Unit coverage for the run-scoped fixture REGISTRY's parser
// (tests/e2e/support/clerk-fixture-registry.ts).
//
// WHY A REGISTRY EXISTS AT ALL (issue #266). The per-scenario `After({ tags:
// "@run-scoped" })` hook can only clean up what a step assigned to a module
// variable — and that assignment happens only once `ensureTeamFixtureUser`
// has returned. Every throw between `POST /users` succeeding and that return
// (a 402 at the decoy-org step, a 429 on the membership lookup) orphans a
// Clerk user that NOTHING in the process knows about. The registry is written
// the instant a remote object is created, so the global teardown can delete it
// even when no step ever saw it.
//
// It is therefore read back after the exact events that make it useful:
// crashes and hard kills. A half-written final line is the NORMAL case, not an
// exotic one, and a parse throw there would take the teardown down with it —
// which is why the parser is pure, tolerant, and pinned here.
import { describe, expect, it } from "vitest";
import { parseRegistry, serializeRegistryEntry } from "./clerk-fixture-registry";

describe("serializeRegistryEntry", () => {
  it("writes one self-contained JSON line, newline-terminated", () => {
    const line = serializeRegistryEntry({
      kind: "user",
      id: "user_123",
      label: "silver-mzq3k9x2ab7c+clerk_test@agranado.com",
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n")).toHaveLength(2);
    expect(JSON.parse(line)).toEqual({
      kind: "user",
      id: "user_123",
      label: "silver-mzq3k9x2ab7c+clerk_test@agranado.com",
    });
  });

  it("round-trips through the parser", () => {
    const entry = { kind: "organization", id: "org_1", label: "arp-e2e-decoy-x" } as const;

    expect(parseRegistry(serializeRegistryEntry(entry))).toEqual([entry]);
  });
});

describe("parseRegistry", () => {
  const user = { kind: "user", id: "user_1", label: "a@agranado.com" } as const;
  const org = { kind: "organization", id: "org_1", label: "arp-e2e-decoy-a" } as const;

  it("reads back every entry, in the order they were recorded", () => {
    const text = serializeRegistryEntry(user) + serializeRegistryEntry(org);

    expect(parseRegistry(text)).toEqual([user, org]);
  });

  it("survives a truncated final line — the crash case the registry exists for", () => {
    const text = `${serializeRegistryEntry(user)}{"kind":"organization","id":"org_`;

    expect(parseRegistry(text)).toEqual([user]);
  });

  it("skips blank lines and entries missing a kind or an id", () => {
    const text = [
      serializeRegistryEntry(user),
      "\n",
      '{"kind":"user"}\n',
      '{"id":"user_2"}\n',
      '{"kind":"satellite","id":"sat_1"}\n',
      '{"kind":"user","id":"","label":"x"}\n',
      "   \n",
    ].join("");

    expect(parseRegistry(text)).toEqual([user]);
  });

  it("de-duplicates, so a re-recorded id is only deleted once", () => {
    const text = serializeRegistryEntry(user) + serializeRegistryEntry(user);

    expect(parseRegistry(text)).toEqual([user]);
  });

  it("returns nothing for an empty or absent registry rather than throwing", () => {
    expect(parseRegistry("")).toEqual([]);
    expect(parseRegistry("\n\n")).toEqual([]);
  });

  it("defaults a missing label to the id, so every log line names something", () => {
    expect(parseRegistry('{"kind":"user","id":"user_9"}\n')).toEqual([
      { kind: "user", id: "user_9", label: "user_9" },
    ]);
  });
});
