import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { buildOpenApiDocument } from '../scripts/gen-openapi.js'

// The committed openapi.json is what orval turns into the web client, and
// nothing else catches a forgotten `gen:openapi` — the generated client's
// unwrap() casts, so a stale spec type-checks fine. Building the document in
// memory and diffing it against the file makes the omission a red test.
//
// Structural, not textual: JSON.stringify formatting and the trailing newline
// are not part of the contract. The round-trip on the left drops keys whose
// value is undefined, which toEqual would otherwise treat as present.
const SPEC_PATH = fileURLToPath(new URL('../../web/openapi.json', import.meta.url))

describe('openapi drift', () => {
  it('the committed openapi.json matches the current route tree', () => {
    const built = JSON.parse(JSON.stringify(buildOpenApiDocument()))
    const committed = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
    expect(built).toEqual(committed)
  })
})
