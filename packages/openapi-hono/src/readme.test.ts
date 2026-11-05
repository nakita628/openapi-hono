/**
 * The examples of README.md (the repository's and the package's), run as they are written: each
 * code block is written out, type-checked, imported and served.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it, test } from 'vite-plus/test'

import { isObject } from './utils/object.js'

const root = join(import.meta.dirname, '..')
const out = join(root, '.readme')

const LIBRARIES = ['Zod', 'Valibot', 'ArkType', 'Effect'] as const
const READMES = { repository: join(root, '..', '..', 'README.md'), package: join(root, 'README.md') }
const FRAMEWORKS = ['Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono'] as const

/** The first `ts` code block under `### <library>`. */
function exampleOf(readme: string, library: string): string {
  const text = readFileSync(readme, 'utf8')
  const at = text.indexOf(`### ${library}\n`)
  const block = /```ts\n([\s\S]*?)```/u.exec(text.slice(at))
  if (at === -1 || block?.[1] === undefined) throw new Error(`${readme} has no example for ${library}`)
  return block[1]
}

const examples = Object.entries(READMES).flatMap(([readme, file]) =>
  LIBRARIES.map((library) => ({ name: `${readme}-${library.toLowerCase()}`, library, code: exampleOf(file, library) })),
)

beforeAll(() => {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const { name, code } of examples) writeFileSync(join(out, `${name}.ts`), code)
  writeFileSync(
    join(out, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { noEmit: true }, include: ['*.ts'] }),
  )
})

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

test('the examples type-check', () => {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  let output = ''
  try {
    execFileSync(tsc, ['-p', join(out, 'tsconfig.json')], { stdio: 'pipe', cwd: root })
  } catch (error) {
    output = String(error instanceof Error && 'stdout' in error ? error.stdout : error)
  }
  expect(output).toBe('')
})

/** What an example exports: the app. */
type Example = { readonly app: { readonly request: (path: string, init?: RequestInit) => Promise<Response> } }

const isExample = (value: unknown): value is Example =>
  isObject(value) && isObject(value.app) && typeof value.app.request === 'function'

describe.each(examples)('the README example $name', ({ name }) => {
  const load = async (): Promise<Example> => {
    const module: unknown = await import(join(out, `${name}.ts`))
    if (!isExample(module)) throw new TypeError(`${name} does not export app`)
    return module
  }

  it.each(FRAMEWORKS)('answers the selected framework: %s', async (selected) => {
    const { app } = await load()
    const res = await app.request('/hono', post({ selected }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: `${selected} is selected` })
  })

  it('answers 400 for a framework that is not one of them', async () => {
    const { app } = await load()
    const res = await app.request('/hono', post({ selected: 'Express' }))
    expect(res.status).toBe(400)
  })

  it('serves the document, the enum named', async () => {
    const { app } = await load()
    const res = await app.request('/doc')
    const doc = await res.json()
    // ArkType writes the values in an order of its own.
    expect(doc.components.schemas.Hono.enum.toSorted()).toEqual([...FRAMEWORKS].toSorted())
    expect(doc.paths['/hono'].post.requestBody.content['application/json'].schema).toMatchObject({
      properties: { selected: { $ref: '#/components/schemas/Hono' } },
    })
  })
})
