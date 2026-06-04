// Aggregates every validator. A validator that throws is itself reported as a
// violation (validator-crash) rather than taking the whole run down.

import * as adrIndexSync from "./validators/adr-index-sync.mjs";
import * as adrMadr from "./validators/adr-madr.mjs";
import * as eventNames from "./validators/event-names.mjs";
import * as featurePresence from "./validators/feature-presence.mjs";
import * as gherkinStructure from "./validators/gherkin-structure.mjs";
import * as glossaryTerms from "./validators/glossary-terms.mjs";
import * as openapiStructure from "./validators/openapi-structure.mjs";

export const VALIDATORS = [
  adrMadr,
  adrIndexSync,
  glossaryTerms,
  eventNames,
  featurePresence,
  gherkinStructure,
  openapiStructure,
];

/** Run all validators against the context; returns a flat list of violations. */
export function runAll(ctx) {
  const violations = [];
  for (const validator of VALIDATORS) {
    try {
      violations.push(...validator.run(ctx));
    } catch (err) {
      violations.push({
        validator: validator.id,
        file: "-",
        rule: "validator-crash",
        message: `Validator threw: ${err?.message ?? String(err)}`,
        hint: "This is a bug in the validator, not the docs.",
      });
    }
  }
  return violations;
}
