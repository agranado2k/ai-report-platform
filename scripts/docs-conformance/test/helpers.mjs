import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import defaultConfig from '../config.mjs';
import { makeContext } from '../context.mjs';

/** Write a `{ 'rel/path': 'content' }` map into a fresh temp dir; return root. */
export function makeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-conf-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

/** Build a context over a fixture tree, with an optional config override. */
export function ctxFor(files, config = defaultConfig) {
  return makeContext({ repoRoot: makeFixture(files), config });
}

export function cleanup(ctx) {
  rmSync(ctx.repoRoot, { recursive: true, force: true });
}

/** A minimal, fully-conformant ADR body. */
export function validAdr(num = '0099', title = 'Test decision') {
  return [
    `# ADR-${num}: ${title}`,
    '',
    '- **Status**: Accepted',
    '',
    '## Context and problem statement',
    'why',
    '## Decision drivers',
    'drivers',
    '## Decision outcome',
    'what we decided',
    '## Considered options',
    'options',
    '## More information',
    'links',
    '',
  ].join('\n');
}

/** A rule id appears among the given violations. */
export function hasRule(violations, rule) {
  return violations.some((v) => v.rule === rule);
}
