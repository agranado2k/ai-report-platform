import { describe, it, expect } from 'vitest'
import { l0Schema, l1Schema, l2Schema } from '../src/lib/schemas'
import { roundtrip } from '../src/lib/roundtrip'
import { classify, type ClassificationDetail } from '../src/lib/classify'
import { fragments } from './fragments'

const LEVELS = [
  { name: 'L0', schema: l0Schema },
  { name: 'L1', schema: l1Schema },
  { name: 'L2', schema: l2Schema },
] as const

describe('Test A: fidelity scorecard', () => {
  const scorecard: Record<string, Record<string, ClassificationDetail & { exported: string }>> = {}

  for (const [fragName, html] of Object.entries(fragments)) {
    describe(fragName, () => {
      for (const level of LEVELS) {
        it(`${level.name}`, () => {
          const exported = roundtrip(html, level.schema)
          const detail = classify(html, exported)
          scorecard[fragName] ??= {}
          scorecard[fragName][level.name] = { ...detail, exported }

          // Sanity assertion only -- classification itself is the deliverable,
          // not a pass/fail gate. We do assert parsing never throws (implicit,
          // since roundtrip() would have thrown above) and that we always got
          // *some* text out unless truly dropped.
          expect(detail.classification).toBeTruthy()
        })
      }
    })
  }

  it('prints the full scorecard', () => {
    // eslint-disable-next-line no-console
    console.log('\n=== TEST A SCORECARD ===')
    const rows: Record<string, unknown>[] = []
    for (const [fragName, byLevel] of Object.entries(scorecard)) {
      const row: Record<string, unknown> = { fragment: fragName }
      for (const level of LEVELS) {
        const d = byLevel[level.name]
        row[level.name] = d ? d.classification : '(not run yet)'
      }
      rows.push(row)
    }
    console.table(rows)

    for (const [fragName, byLevel] of Object.entries(scorecard)) {
      for (const level of LEVELS) {
        const d = byLevel[level.name]
        if (!d) continue
        if (d.classification !== 'lossless') {
          console.log(
            `\n[${fragName} / ${level.name}] => ${d.classification}` +
              (d.classesMissing.length ? `\n  classes missing: ${d.classesMissing.join(', ')}` : '') +
              (d.tagsMissingEntirely.length ? `\n  tags missing: ${d.tagsMissingEntirely.join(', ')}` : '') +
              (d.missingWords.length ? `\n  words missing: ${d.missingWords.slice(0, 15).join(', ')}` : ''),
          )
        }
      }
    }
    expect(true).toBe(true)
  })
})
