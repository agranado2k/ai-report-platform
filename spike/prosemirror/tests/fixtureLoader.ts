import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Fixture lives in the sibling spike/fixture/ directory. It is READ-ONLY for
// this spike -- never write to it from anywhere in this repo.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURE_PATH = path.resolve(__dirname, '../../fixture/ai-readiness-report.html')

export function loadFixtureHtml(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8')
}
