import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as openapiStructure from '../validators/openapi-structure.mjs';
import { runAll } from '../runner.mjs';
import defaultConfig from '../config.mjs';
import { ctxFor, cleanup, hasRule, validAdr } from './helpers.mjs';

test('openapi-structure: a missing document is flagged', () => {
  const ctx = ctxFor({});
  assert.ok(hasRule(openapiStructure.run(ctx), 'openapi-missing'));
  cleanup(ctx);
});

test('openapi-structure: a missing required token is flagged', () => {
  const ctx = ctxFor({ 'docs/api/openapi.yaml': 'openapi: 3.1\n# nothing else' });
  const violations = openapiStructure.run(ctx);
  assert.ok(hasRule(violations, 'openapi-missing-token'));
  assert.ok(violations.some((v) => v.message.includes('application/problem+json')));
  cleanup(ctx);
});

test('openapi-structure: a doc containing all tokens passes', () => {
  const doc = `openapi: 3.1.0\n${defaultConfig.openapi.mustContain.join('\n')}\n`;
  const ctx = ctxFor({ 'docs/api/openapi.yaml': doc });
  assert.deepEqual(openapiStructure.run(ctx), []);
  cleanup(ctx);
});

test('runner: a fully clean fixture yields zero violations', () => {
  const config = {
    ...defaultConfig,
    events: ['ReportVersionUploaded'],
    features: { demo: { title: 'Demo', phase: '@phase-1', status: 'full' } },
  };
  const ctx = ctxFor(
    {
      'docs/adr/0099-test-decision.md': validAdr(),
      'docs/adr/INDEX.md': '| 0099 | [Test](0099-test-decision.md) | Accepted |',
      'docs/events.md': 'ReportVersionUploaded',
      'docs/domain-glossary.md': 'ReportVersionUploaded',
      'docs/api/openapi.yaml': `openapi: 3.1.0\n${defaultConfig.openapi.mustContain.join('\n')}\n`,
      'tests/e2e/features/demo.feature': '@phase-1\nFeature: Demo\n\n  Scenario: ok\n    Given x\n    Then y\n',
    },
    config,
  );
  assert.deepEqual(runAll(ctx), []);
  cleanup(ctx);
});

test('runner: a multi-fault fixture surfaces several validators', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr().replace('Accepted', 'Maybe'), // bad status
    'docs/notes.md': 'The Version is here.', // banned alias
    // no openapi, no features, no events → more violations
  });
  const violations = runAll(ctx);
  const validators = new Set(violations.map((v) => v.validator));
  assert.ok(validators.has('adr-madr'));
  assert.ok(validators.has('glossary-terms'));
  assert.ok(validators.has('openapi-structure'));
  cleanup(ctx);
});
