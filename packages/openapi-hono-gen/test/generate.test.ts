/**
 * The file generated from test/openapi.yaml, with each schema library and each set of options:
 * it type-checks, and its app checks the requests and writes the document.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Effect } from 'effect'
import { parseOpenAPI } from 'oas-truth'
import type { OpenAPI } from 'oas-truth'
import { beforeAll, describe, expect, it, test } from 'vite-plus/test'

import { parseConfig } from '../src/config.js'
import type { ConfigInput } from '../src/config.js'
import { generate } from '../src/generate.js'
import { typeErrorsBesidesEmptyHandlers } from './typecheck.js'

const here = import.meta.dirname
const LIBRARIES = ['zod', 'valibot', 'arktype', 'effect'] as const

const VARIANTS = {
  routes: {},
  operation: { client: { output: 'client.ts', mode: 'operation' } },
  'operation-split': { client: { output: 'client.ts', mode: 'operation' }, split: true },
  template: { template: true },
  'template-operation': { template: true, client: { output: 'client.ts', mode: 'operation' } },
  'template-hc-split': { template: true, split: true, client: { output: 'client.ts', mode: 'hc' } },
  exports: {
    template: true,
    exportSchemas: true,
    exportSchemasTypes: true,
    exportResponses: true,
    exportParameters: true,
    exportParametersTypes: true,
    exportRequestBodies: true,
    exportHeaders: true,
    exportHeadersTypes: true,
    exportExamples: true,
    exportSecuritySchemes: true,
    exportLinks: true,
    exportCallbacks: true,
    exportPathItems: true,
    exportMediaTypes: true,
    exportMediaTypesTypes: true,
  },
} satisfies Record<string, Partial<ConfigInput>>

type Variant = keyof typeof VARIANTS

/** A file written for the library and the variant: `routes.ts`, `index.ts`, `client.ts`, `handlers/*.ts`. */
const fileOf = (library: string, variant: Variant, file = 'routes.ts') =>
  join(here, 'generated', `${library}-${variant}`, file)

let document: OpenAPI

async function write(library: (typeof LIBRARIES)[number], variant: Variant) {
  const config = await Effect.runPromise(
    parseConfig({ input: 'test/openapi.yaml', output: 'routes.ts', schema: library, ...VARIANTS[variant] }),
  )
  const files = await Effect.runPromise(generate(document, config))
  for (const [file, code] of files) {
    mkdirSync(dirname(fileOf(library, variant, file)), { recursive: true })
    writeFileSync(fileOf(library, variant, file), code)
  }
  return files
}

beforeAll(async () => {
  const parsed = await parseOpenAPI(join(here, 'openapi.yaml'))
  if (!parsed.ok) throw new Error(parsed.error)
  document = parsed.value
  mkdirSync(join(here, 'generated'), { recursive: true })
  const variants = Object.keys(VARIANTS) as Variant[]
  await Promise.all(LIBRARIES.flatMap((library) => variants.map((variant) => write(library, variant))))
})

describe('the config', () => {
  it("rejects client.mode 'hc' without template, which types it", async () => {
    const exit = await Effect.runPromiseExit(
      parseConfig({ input: 'a.yaml', output: 'a.ts', client: { output: 'client.ts', mode: 'hc' } }),
    )
    expect(JSON.stringify(exit)).toContain("client.mode 'hc' is typed by the app")
  })

  it('rejects an output the scaffold writes itself', async () => {
    const index = await Effect.runPromiseExit(parseConfig({ input: 'a.yaml', output: 'src/index.ts', template: true }))
    expect(JSON.stringify(index)).toContain('the app entry is index.ts next to output')
    const client = await Effect.runPromiseExit(
      parseConfig({
        input: 'a.yaml',
        output: 'src/routes.ts',
        client: { output: './src/routes.ts', mode: 'operation' },
      }),
    )
    expect(JSON.stringify(client)).toContain('the client is a file of its own')
  })

  it('names the field that is wrong', async () => {
    const exit = await Effect.runPromiseExit(parseConfig({ input: 'a.yaml', output: 'a.ts', schema: 'yup' }))
    expect(JSON.stringify(exit)).toContain('schema')
  })
})

test('every generated file type-checks, but for the empty handlers', () => {
  expect(typeErrorsBesidesEmptyHandlers('tsconfig.json')).toEqual([])
})

describe.each(LIBRARIES)('with %s', (library) => {
  it('writes the routes, and only them by default', async () => {
    const mod = await import(fileOf(library, 'routes'))
    expect(Object.keys(mod).toSorted()).toEqual([
      'deleteTodosTodoIdRoute',
      'getIndexRoute',
      'getTodosRoute',
      'getTodosTodoIdRoute',
      'postNoteRoute',
      'postTodosRoute',
    ])
    expect(mod.getTodosTodoIdRoute.path).toBe('/todos/{todoId}')
  })

  it('exports the components as the config says, the routes referring to them', async () => {
    const mod = await import(fileOf(library, 'exports'))
    expect(Object.keys(mod)).toEqual(
      expect.arrayContaining(['TodoSchema', 'TreeSchema', 'ErrorResponse', 'RequestIdParamsSchema']),
    )
    expect(mod.postTodosRoute.responses['400']).toBe(mod.ErrorResponse)
    const { default: app } = await import(fileOf(library, 'exports', 'index.ts'))
    // The config is the user's: the components are named by the routes.
    const doc = app.getOpenAPIDocument({ info: { title: 'Todos', version: '1.0.0' } })
    expect(doc.paths['/todos'].post.responses['400']).toEqual({ $ref: '#/components/responses/Error' })
    expect(doc.components.responses.Error).toMatchObject({ description: 'An error' })
  })

  it('writes a client by operationId, naming the operations without one', async () => {
    const mod = await import(fileOf(library, 'operation', 'client.ts'))
    const client = mod.createApiClient('http://localhost')
    expect(Object.keys(client)).toEqual(
      expect.arrayContaining(['getIndex', 'getTodos', 'postTodos', 'getTodosTodoId', 'deleteTodosTodoId', 'postNote']),
    )
  })

  it('writes a client for each group with split', async () => {
    const mod = await import(fileOf(library, 'operation-split', 'client.ts'))
    expect(Object.keys(mod.createTodosClient('http://localhost')).toSorted()).toEqual([
      'deleteTodosTodoId',
      'getTodos',
      'getTodosTodoId',
      'postTodos',
    ])
    expect(Object.keys(mod.createNotesClient('http://localhost'))).toEqual(['postNote'])
    expect(Object.keys(mod.createIndexClient('http://localhost'))).toEqual(['getIndex'])
  })

  it('scaffolds the app: a handler file for each tag, the app entry, and the client', async () => {
    const files = await write(library, 'template-hc-split')
    expect([...files.keys()].toSorted()).toEqual([
      'client.ts',
      'handlers/index.ts',
      'handlers/notes.ts',
      'handlers/root.ts',
      'handlers/todos.ts',
      'index.ts',
      'routes.ts',
    ])
    // The hc client of each group, its type declared once (hcWithType).
    const client = files.get('client.ts') ?? ''
    expect(client).toContain('type TodosClient = ReturnType<typeof hc<typeof todosApi>>')
    expect(client).toMatch(
      /const hcTodosWithType = \(\.\.\.args: Parameters<typeof hc>\): TodosClient =>\s+hc<typeof todosApi>\(\.\.\.args\)/u,
    )
    expect(client).toContain("export const todosClient = hcTodosWithType('/')")
    const { todosClient } = await import(fileOf(library, 'template-hc-split', 'client.ts'))
    expect(typeof todosClient.todos.$get).toBe('function')
  })

  it.each(['template', 'template-operation', 'template-hc-split'] as const)(
    'serves the app of %s: the checks before the empty handlers (Hono answers 404), and the document',
    async (variant) => {
      const { default: app } = await import(fileOf(library, variant, 'index.ts'))
      const status = async (path: string, init?: RequestInit) => {
        const res = await app.request(path, init)
        return res.status
      }
      expect(await status('/todos?limit=2')).toBe(404)
      expect(await status('/todos?limit=0')).toBe(400)
      expect(await status('/todos/1')).toBe(404)
      expect(await status('/todos/one')).toBe(400)
      const form = (body: string) => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      expect(await status('/notes', form('text=hi&pinned=true'))).toBe(404)
      expect(await status('/notes', form('pinned=true'))).toBe(400)
      const doc = app.getOpenAPIDocument({ info: { title: 'Todos', version: '1.0.0' } })
      expect(Object.keys(doc.paths)).toEqual(['/', '/todos', '/todos/{todoId}', '/notes'])
      expect(doc.components.schemas).toHaveProperty('Todo')
      expect(doc.paths['/todos'].get.responses['200'].content['application/json'].schema).toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/Todo' },
      })
      expect(doc.paths['/notes'].post.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/Tree',
      })
      // ArkType names the cycle of a recursive schema itself (`intersection229`).
      if (library !== 'arktype') {
        expect(doc.components.schemas.Tree.properties.children.items).toEqual({ $ref: '#/components/schemas/Tree' })
      }
    },
  )
})
