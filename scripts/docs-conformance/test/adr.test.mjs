import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adrMadr from '../validators/adr-madr.mjs';
import * as adrIndexSync from '../validators/adr-index-sync.mjs';
import { ctxFor, cleanup, validAdr, hasRule } from './helpers.mjs';

test('adr-madr: a conformant ADR produces no violations', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr(),
    'docs/adr/INDEX.md': '| 0099 | [Test](0099-test-decision.md) | Accepted |',
  });
  assert.deepEqual(adrMadr.run(ctx), []);
  cleanup(ctx);
});

test('adr-madr: bad status value is flagged', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr().replace('Accepted', 'Maybe'),
  });
  assert.ok(hasRule(adrMadr.run(ctx), 'adr-status-value'));
  cleanup(ctx);
});

test('adr-madr: a missing required section is flagged', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr().replace('## More information\nlinks', ''),
  });
  assert.ok(hasRule(adrMadr.run(ctx), 'adr-section'));
  cleanup(ctx);
});

test('adr-madr: a non-conformant filename is flagged', () => {
  const ctx = ctxFor({ 'docs/adr/badname.md': validAdr() });
  assert.ok(hasRule(adrMadr.run(ctx), 'adr-filename'));
  cleanup(ctx);
});

test('adr-index-sync: an ADR file with no index row is flagged', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr(),
    'docs/adr/INDEX.md': '# Index\n(no rows)',
  });
  assert.ok(hasRule(adrIndexSync.run(ctx), 'adr-not-in-index'));
  cleanup(ctx);
});

test('adr-index-sync: a dangling index link is flagged', () => {
  const ctx = ctxFor({
    'docs/adr/INDEX.md': '| 0098 | [Ghost](0098-ghost.md) | Accepted |',
  });
  assert.ok(hasRule(adrIndexSync.run(ctx), 'index-dangling-link'));
  cleanup(ctx);
});

test('adr-index-sync: a matched pair produces no violations', () => {
  const ctx = ctxFor({
    'docs/adr/0099-test-decision.md': validAdr(),
    'docs/adr/INDEX.md': '| 0099 | [Test](0099-test-decision.md) | Accepted |',
  });
  assert.deepEqual(adrIndexSync.run(ctx), []);
  cleanup(ctx);
});
