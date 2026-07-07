import { describe, it, expect } from 'vitest'
import { suggestionSchema } from '../src/lib/suggestionSchema'
import { parseFragment, serializeDoc } from '../src/lib/roundtrip'
import { findTextblockRange, proposeSuggestion, acceptSuggestion, rejectSuggestion } from '../src/lib/suggestion'

const DESC_PARAGRAPH_HTML =
  '<p class="desc">Tokenization, attention, KV cache, sampling, context-window economics, why fine-tunes drift. Goal is not to train; goal is to debug latency spikes and hallucinations without guessing.</p>'

const CANNED_REPLACEMENT = 'This is a suggested rewrite for testing purposes.'

describe('Test C: suggestion capability smoke test', () => {
  it('accept path: exported HTML contains the new text and not the old', () => {
    const doc = parseFragment(DESC_PARAGRAPH_HTML, suggestionSchema)
    const range = findTextblockRange(doc, (t) => t.includes('Tokenization'))
    expect(range).not.toBeNull()

    const proposed = proposeSuggestion(doc, suggestionSchema, range!, CANNED_REPLACEMENT)
    const proposedHtml = serializeDoc(proposed, suggestionSchema)
    // pending state should show both the struck-through old text and the underlined new text
    expect(proposedHtml).toContain('pm-suggest-delete')
    expect(proposedHtml).toContain('pm-suggest-insert')
    expect(proposedHtml).toContain('Tokenization')
    expect(proposedHtml).toContain(CANNED_REPLACEMENT)

    const accepted = acceptSuggestion(proposed, suggestionSchema)
    const acceptedHtml = serializeDoc(accepted, suggestionSchema)

    expect(acceptedHtml).toContain(CANNED_REPLACEMENT)
    expect(acceptedHtml).not.toContain('Tokenization')
    expect(acceptedHtml).not.toContain('pm-suggest-insert')
    expect(acceptedHtml).not.toContain('pm-suggest-delete')
  })

  it('reject path: exported HTML is unchanged from the original (fresh state, same suggestion)', () => {
    const doc = parseFragment(DESC_PARAGRAPH_HTML, suggestionSchema)
    const originalHtml = serializeDoc(doc, suggestionSchema)

    const range = findTextblockRange(doc, (t) => t.includes('Tokenization'))
    expect(range).not.toBeNull()

    const proposed = proposeSuggestion(doc, suggestionSchema, range!, CANNED_REPLACEMENT)
    const rejected = rejectSuggestion(proposed, suggestionSchema)
    const rejectedHtml = serializeDoc(rejected, suggestionSchema)

    expect(rejectedHtml).toBe(originalHtml)
    expect(rejectedHtml).toContain('Tokenization')
    expect(rejectedHtml).not.toContain(CANNED_REPLACEMENT)
    expect(rejectedHtml).not.toContain('pm-suggest-insert')
    expect(rejectedHtml).not.toContain('pm-suggest-delete')
  })
})
