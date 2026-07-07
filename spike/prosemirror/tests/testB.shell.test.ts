import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitDocument, reinject } from '../src/lib/shell'
import { l1Schema } from '../src/lib/schemas'
import { roundtrip } from '../src/lib/roundtrip'
import { extractClasses } from '../src/lib/classify'
import { loadFixtureHtml } from './fixtureLoader'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../out')

describe('Test B: presentation-shell round-trip (full body, L1 schema)', () => {
  it('reinjects the full-body L1 round-trip into the original shell and writes out/roundtrip.html', () => {
    const original = loadFixtureHtml()
    const { shell, bodyHtml } = splitDocument(original)

    const roundtrippedBody = roundtrip(bodyHtml, l1Schema)
    const fullDoc = reinject(shell, roundtrippedBody)

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(path.join(OUT_DIR, 'roundtrip.html'), fullDoc, 'utf-8')

    // sanity: still a well-formed-ish document with the shell's <style> intact
    expect(fullDoc).toContain('<style>')
    expect(fullDoc.length).toBeGreaterThan(1000)

    const BESPOKE_CLASSES = [
      'chip',
      'chip-cto',
      'chip-staff',
      'chip-pm',
      'chip-now',
      'chip-1yr',
      'chip-5yr',
      'chip-have',
      'chip-sharpen',
      'chip-build',
      'card',
      'checklist',
      'resrow',
      'resgroup',
      'sec',
      'secnum',
      'pill',
      'kbd',
      'desc',
      'rmeta',
      'rtags',
      'rt',
      'rd',
    ]

    const origCounts = new Map<string, number>()
    for (const c of extractClasses(bodyHtml)) origCounts.set(c, (origCounts.get(c) || 0) + 1)
    const gotCounts = new Map<string, number>()
    for (const c of extractClasses(roundtrippedBody)) gotCounts.set(c, (gotCounts.get(c) || 0) + 1)

    const report = BESPOKE_CLASSES.map((c) => ({
      class: c,
      original: origCounts.get(c) || 0,
      roundtripped: gotCounts.get(c) || 0,
      delta: (gotCounts.get(c) || 0) - (origCounts.get(c) || 0),
    }))

    // eslint-disable-next-line no-console
    console.log('\n=== TEST B: bespoke class inventory (original vs L1 round-trip) ===')
    console.table(report)

    writeFileSync(
      path.join(OUT_DIR, 'test-b-class-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8',
    )

    expect(report.length).toBe(BESPOKE_CLASSES.length)
  })
})
