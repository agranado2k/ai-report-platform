import { describe, it, expect } from 'vitest'
import { splitDocument, reinject } from '../src/lib/shell'
import { loadFixtureHtml } from './fixtureLoader'

describe('shell split/reinject', () => {
  it('round-trips the real fixture byte-identically when body is unchanged', () => {
    const original = loadFixtureHtml()
    const { shell, bodyHtml } = splitDocument(original)

    // sanity: the body content actually contains something recognizable
    expect(bodyHtml).toContain('class="shell"')
    expect(bodyHtml).toContain('Executive summary')
    // sanity: shell captured the <style> block, not the body content
    expect(shell.pre).toContain('<style>')
    expect(shell.pre).not.toContain('Executive summary')

    const reconstituted = reinject(shell, bodyHtml)
    expect(reconstituted).toBe(original)
    expect(reconstituted.length).toBe(original.length)
  })

  it('re-injecting a modified body only changes the body region', () => {
    const original = loadFixtureHtml()
    const { shell, bodyHtml } = splitDocument(original)
    const modifiedBody = bodyHtml.replace('Executive summary', 'Executive Summary EDITED')
    const result = reinject(shell, modifiedBody)

    expect(result).not.toBe(original)
    expect(result).toContain('Executive Summary EDITED')
    expect(result.startsWith(shell.pre)).toBe(true)
    expect(result.endsWith(shell.post)).toBe(true)
  })
})
