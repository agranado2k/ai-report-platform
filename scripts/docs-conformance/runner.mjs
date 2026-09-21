// Aggregates every validator. A validator that throws is itself reported as a
// finding (validator-crash, a violation) rather than taking the whole run down.
//
// VALIDATORS is the registration list: a validator arrives as data here. The
// reduced POSIX notice in scripts/check.sh must name every scan on it, and
// the kit's self-host suite holds the notice to this list (#129).
//
// LOCAL FORK (centaur-spec, recorded in VERSION): the kit's v0.20.0 runner
// VERBATIM plus the eight local docs-skeleton validators registered alongside
// the kit's eight. Retires when the kit upstreams the docs-skeleton validators.

import * as adrIndexSync from "./validators/adr-index-sync.mjs";
import * as adrMadr from "./validators/adr-madr.mjs";
import * as bannedWords from "./validators/banned-words.mjs";
import * as claudeMdRefs from "./validators/claude-md-refs.mjs";
import * as designBrief from "./validators/design-brief.mjs";
import * as eventNames from "./validators/event-names.mjs";
import * as featureExecutes from "./validators/feature-executes.mjs";
import * as featurePresence from "./validators/feature-presence.mjs";
import * as gherkinStructure from "./validators/gherkin-structure.mjs";
import * as glossaryTerms from "./validators/glossary-terms.mjs";
import * as housekeepingDue from "./validators/housekeeping-due.mjs";
import * as mutationDecision from "./validators/mutation-decision.mjs";
import * as openapiStructure from "./validators/openapi-structure.mjs";
import * as skillBridge from "./validators/skill-bridge.mjs";
import * as skillPaths from "./validators/skill-paths.mjs";
import * as skillWeb from "./validators/skill-web.mjs";

export const VALIDATORS = [
  // LOCAL docs-skeleton validators (ADR-026/0041 trigger matrix).
  adrMadr,
  adrIndexSync,
  glossaryTerms,
  eventNames,
  featurePresence,
  featureExecutes,
  gherkinStructure,
  openapiStructure,
  // The kit's v0.20.0 registration list, verbatim. Advisories among them are
  // warnings, never violations; index.mjs splits by severity and only it
  // decides the exit code.
  bannedWords,
  claudeMdRefs,
  designBrief,
  housekeepingDue,
  mutationDecision,
  skillBridge,
  skillPaths,
  skillWeb,
];

/** Run all validators against the context; returns a flat list of findings —
 * violations and warnings alike. `index.mjs` splits them by severity; only it
 * decides the exit code. */
export function runAll(ctx) {
  const findings = [];
  for (const validator of VALIDATORS) {
    try {
      findings.push(...validator.run(ctx));
    } catch (err) {
      findings.push({
        validator: validator.id,
        file: "-",
        rule: "validator-crash",
        message: `Validator threw: ${err?.message ?? String(err)}`,
        hint: "This is a bug in the validator, not the docs.",
      });
    }
  }
  return findings;
}
