import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as featurePresence from '../validators/feature-presence.mjs';
import * as gherkinStructure from '../validators/gherkin-structure.mjs';
import defaultConfig from '../config.mjs';
import { ctxFor, cleanup, hasRule } from './helpers.mjs';

const oneEntryConfig = {
  ...defaultConfig,
  features: { 'demo-use-case': { title: 'Demo', phase: '@phase-1', status: 'full' } },
};

const validFeature = `@phase-1
Feature: Demo use-case

  Scenario: it works
    Given a thing
    When I do it
    Then it happens
`;

test('feature-presence: a catalogued use-case with no file is flagged', () => {
  const ctx = ctxFor({}, oneEntryConfig);
  assert.ok(hasRule(featurePresence.run(ctx), 'feature-missing'));
  cleanup(ctx);
});

test('feature-presence: an orphan feature file is flagged', () => {
  const ctx = ctxFor(
    {
      'tests/e2e/features/demo-use-case.feature': validFeature,
      'tests/e2e/features/orphan.feature': validFeature,
    },
    oneEntryConfig,
  );
  const violations = featurePresence.run(ctx);
  assert.ok(hasRule(violations, 'feature-orphan'));
  assert.ok(violations.some((v) => v.file.includes('orphan')));
  cleanup(ctx);
});

test('feature-presence: an exact match produces no violations', () => {
  const ctx = ctxFor(
    { 'tests/e2e/features/demo-use-case.feature': validFeature },
    oneEntryConfig,
  );
  assert.deepEqual(featurePresence.run(ctx), []);
  cleanup(ctx);
});

test('gherkin-structure: a well-formed feature produces no violations', () => {
  const ctx = ctxFor({ 'tests/e2e/features/demo.feature': validFeature });
  assert.deepEqual(gherkinStructure.run(ctx), []);
  cleanup(ctx);
});

test('gherkin-structure: missing Feature/Scenario is flagged', () => {
  const ctx = ctxFor({ 'tests/e2e/features/demo.feature': '@phase-1\njust some text' });
  const violations = gherkinStructure.run(ctx);
  assert.ok(hasRule(violations, 'no-feature'));
  assert.ok(hasRule(violations, 'no-scenario'));
  cleanup(ctx);
});

test('gherkin-structure: a missing phase tag is flagged', () => {
  const ctx = ctxFor({
    'tests/e2e/features/demo.feature': validFeature.replace('@phase-1\n', ''),
  });
  assert.ok(hasRule(gherkinStructure.run(ctx), 'no-phase-tag'));
  cleanup(ctx);
});

test('gherkin-structure: an unknown tag is flagged', () => {
  const ctx = ctxFor({
    'tests/e2e/features/demo.feature': `@phase-1 @bogus\n${validFeature}`,
  });
  assert.ok(hasRule(gherkinStructure.run(ctx), 'unknown-tag'));
  cleanup(ctx);
});

test('gherkin-structure: multiple phase tags are flagged', () => {
  const ctx = ctxFor({
    'tests/e2e/features/demo.feature': validFeature.replace('@phase-1', '@phase-1 @phase-2'),
  });
  assert.ok(hasRule(gherkinStructure.run(ctx), 'multiple-phase-tags'));
  cleanup(ctx);
});
