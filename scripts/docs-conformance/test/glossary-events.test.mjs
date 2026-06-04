import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as glossaryTerms from '../validators/glossary-terms.mjs';
import * as eventNames from '../validators/event-names.mjs';
import defaultConfig from '../config.mjs';
import { ctxFor, cleanup, hasRule } from './helpers.mjs';

test('glossary-terms: standalone "Version" is flagged', () => {
  const ctx = ctxFor({ 'docs/notes.md': 'The Version is served at the root.' });
  assert.ok(hasRule(glossaryTerms.run(ctx), 'banned-alias'));
  cleanup(ctx);
});

test('glossary-terms: "ReportVersion" is not a false positive', () => {
  const ctx = ctxFor({ 'docs/notes.md': 'A ReportVersion is a snapshot; version_no orders them.' });
  assert.deepEqual(glossaryTerms.run(ctx), []);
  cleanup(ctx);
});

test('glossary-terms: lines documenting the ban are skipped', () => {
  const ctx = ctxFor({ 'docs/notes.md': '_Avoid_: Version (ambiguous — use ReportVersion).' });
  assert.deepEqual(glossaryTerms.run(ctx), []);
  cleanup(ctx);
});

test('glossary-terms: excluded files are not scanned', () => {
  const ctx = ctxFor({ 'docs/diary.md': 'Renamed Version to ReportVersion.' });
  assert.deepEqual(glossaryTerms.run(ctx), []);
  cleanup(ctx);
});

test('event-names: a missing canonical event is flagged', () => {
  const config = { ...defaultConfig, events: ['ReportVersionUploaded', 'ReportPublished'] };
  const ctx = ctxFor(
    {
      'docs/events.md': 'ReportVersionUploaded happens on upload.',
      'docs/domain-glossary.md': 'ReportVersionUploaded, ReportPublished',
    },
    config,
  );
  // events.md is missing ReportPublished.
  const violations = eventNames.run(ctx);
  assert.ok(hasRule(violations, 'event-missing'));
  assert.ok(violations.some((v) => v.message.includes('ReportPublished')));
  cleanup(ctx);
});

test('event-names: all events present in both sources → no violations', () => {
  const config = { ...defaultConfig, events: ['ReportVersionUploaded', 'ReportPublished'] };
  const body = 'ReportVersionUploaded and ReportPublished';
  const ctx = ctxFor(
    { 'docs/events.md': body, 'docs/domain-glossary.md': body },
    config,
  );
  assert.deepEqual(eventNames.run(ctx), []);
  cleanup(ctx);
});
