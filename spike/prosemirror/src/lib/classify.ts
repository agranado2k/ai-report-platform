/**
 * Small string-based heuristics to classify a round-trip result without
 * hand-judging every case. Deliberately simple (regex-based) since this is a
 * throwaway spike, not production diffing logic.
 */

export type Classification = 'lossless' | 'styling-lost' | 'structure-lost' | 'dropped'

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function textOnly(html: string): string {
  const stripped = html.replace(/<[^>]*>/g, ' ')
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

export function extractTags(html: string): string[] {
  const tags: string[] = []
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) tags.push(m[1].toLowerCase())
  return tags
}

export function extractClasses(html: string): string[] {
  const classes: string[] = []
  const re = /class="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) classes.push(c)
  }
  return classes
}

export interface ClassificationDetail {
  classification: Classification
  textOriginalLen: number
  textExportedLen: number
  missingWords: string[]
  tagsMissingEntirely: string[]
  classesMissing: string[]
  classesExtra: string[]
}

export function classify(original: string, exported: string): ClassificationDetail {
  const textOrig = textOnly(original)
  const textExp = textOnly(exported)

  const origWords = textOrig.split(' ').filter((w) => w.length > 3)
  // Compare against a whitespace-collapsed blob (not a word set) so that
  // legitimate whitespace-concatenation artifacts (e.g. a <span> hugging the
  // next word with no space in the source markup, which some schema levels
  // flatten into a single run) aren't mistaken for actually-dropped content.
  const expBlob = textExp.replace(/\s+/g, '')
  const missingWords = origWords.filter((w) => !expBlob.includes(w))
  const droppedRatio = origWords.length === 0 ? 0 : missingWords.length / origWords.length

  const tagsOrig = new Set(extractTags(original))
  const tagsExp = new Set(extractTags(exported))
  // ignore div/span -- generic wrappers are allowed to change freely; we care
  // about *semantic* element types (table/details/ul/etc.) surviving.
  const semanticTags = [...tagsOrig].filter((t) => !['div', 'span'].includes(t))
  const tagsMissingEntirely = semanticTags.filter((t) => !tagsExp.has(t))

  const classesOrigCount = new Map<string, number>()
  for (const c of extractClasses(original)) classesOrigCount.set(c, (classesOrigCount.get(c) || 0) + 1)
  const classesExpCount = new Map<string, number>()
  for (const c of extractClasses(exported)) classesExpCount.set(c, (classesExpCount.get(c) || 0) + 1)

  const classesMissing: string[] = []
  for (const [c, n] of classesOrigCount) {
    const have = classesExpCount.get(c) || 0
    if (have < n) classesMissing.push(`${c} (${have}/${n})`)
  }
  const classesExtra: string[] = []
  for (const [c, n] of classesExpCount) {
    const had = classesOrigCount.get(c) || 0
    if (n > had) classesExtra.push(`${c} (+${n - had})`)
  }

  let classification: Classification
  if (droppedRatio > 0.4) {
    classification = 'dropped'
  } else if (tagsMissingEntirely.length > 0) {
    classification = 'structure-lost'
  } else if (classesMissing.length > 0) {
    classification = 'styling-lost'
  } else {
    classification = 'lossless'
  }

  return {
    classification,
    textOriginalLen: textOrig.length,
    textExportedLen: textExp.length,
    missingWords,
    tagsMissingEntirely,
    classesMissing,
    classesExtra,
  }
}
