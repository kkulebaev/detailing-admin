import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { buildOpenApiDocument } from '../scripts/gen-openapi.js'

// Из закоммиченного openapi.json orval собирает веб-клиент, и больше ничто
// не ловит забытый `gen:openapi` — сгенерированный unwrap() делает приведение
// типов, так что устаревшая спека спокойно проходит тайпчек. Сборка документа
// в памяти и сравнение с файлом превращают такую забывчивость в красный тест.
//
// Сравнение структурное, а не текстовое: форматирование JSON.stringify и
// завершающий перевод строки в контракт не входят. Round-trip слева отбрасывает
// ключи со значением undefined, которые toEqual иначе считал бы присутствующими.
const SPEC_PATH = fileURLToPath(new URL('../../web/openapi.json', import.meta.url))

describe('дрейф openapi', () => {
  it('закоммиченный openapi.json совпадает с текущим деревом роутов', () => {
    const built = JSON.parse(JSON.stringify(buildOpenApiDocument()))
    const committed = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
    expect(built).toEqual(committed)
  })
})
