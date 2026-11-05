/**
 * Generating again over the files the user has worked on: their handlers (where they put them),
 * their code and their app set-up stay; the routes of the document are registered, and the
 * handlers of the routes that are gone removed.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Effect } from 'effect'
import { parseOpenAPI } from 'oas-truth'
import type { OpenAPI } from 'oas-truth'
import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { parseConfig } from '../src/config.js'
import { generate } from '../src/generate.js'
import { typeErrorsBesidesEmptyHandlers } from './typecheck.js'

const here = import.meta.dirname
const directory = join(here, 'generated', 'merge-zod')

let document: OpenAPI

beforeAll(async () => {
  const parsed = await parseOpenAPI(join(here, 'openapi.yaml'))
  if (!parsed.ok) throw new Error(parsed.error)
  document = parsed.value
})

const configOf = () =>
  Effect.runPromise(
    parseConfig({
      input: 'openapi.yaml',
      output: 'routes.ts',
      schema: 'zod',
      template: true,
      client: { output: 'client.ts', mode: 'hc' },
      exportSchemas: true,
    }),
  )

/** The document without DELETE /todos/{todoId}, with GET /health. */
function changed(): OpenAPI {
  const { delete: _delete, ...todo } = document.paths['/todos/{todoId}'] ?? {}
  return {
    ...document,
    paths: {
      ...document.paths,
      '/todos/{todoId}': todo,
      '/health': { get: { operationId: 'getHealth', responses: { 200: { description: 'Healthy' } } } },
    },
  }
}

const STUB = (name: string) =>
  new RegExp(`export const ${name}: RouteHandler<typeof \\w+> = async \\(c\\) => \\{\\}\\n?`, 'u')

/** The files as the user has worked on them. */
function edited(files: ReadonlyMap<string, string>): Map<string, string> {
  const get = (file: string) => files.get(file) ?? ''
  const root = get('handlers/root.ts')
  const indexHandler = STUB('getIndexRouteHandler').exec(root)?.[0] ?? ''
  const todos = get('handlers/todos.ts').replace(
    STUB('getTodosRouteHandler'),
    [
      '// Mine: the todos of the store.',
      'export const getTodosRouteHandler: RouteHandler<typeof getTodosRoute> = (c) =>',
      '  c.json([...store.values()], 200)',
      '',
      'const store = new Map<number, ReturnType<typeof TodoSchema.parse>>()',
      '',
    ].join('\n'),
  )
  return new Map([
    ...files,
    // getIndexRouteHandler moved from root.ts into todos.ts.
    ['handlers/root.ts', root.replace(indexHandler, '')],
    [
      'handlers/todos.ts',
      // A component of the routes file, imported by the user.
      `import { TodoSchema } from '../routes.js'\n${todos.replace('import type {\n', 'import type {\n  getIndexRoute,\n')}\n${indexHandler}`,
    ],
    [
      'index.ts',
      get('index.ts')
        .replace(
          "import { Hono } from 'hono'",
          "import { Hono } from 'hono'\nimport { logger } from 'hono/logger'\nimport type { MiddlewareHandler } from 'hono'",
        )
        .replace(
          'const app = new Hono()',
          'const timing: MiddlewareHandler = async (_c, next) => {\n  await next()\n}\n\nconst app = new Hono().use(logger()).use(timing)',
        ),
    ],
  ])
}

function write(files: ReadonlyMap<string, string>) {
  rmSync(directory, { recursive: true, force: true })
  for (const [file, code] of files) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), code)
  }
}

describe('generating again over the files', () => {
  it("keeps the user's handlers where they are, their code and app set-up, and registers the routes", async () => {
    const config = await configOf()
    const mine = edited(await Effect.runPromise(generate(document, config)))
    const files = await Effect.runPromise(generate(changed(), config, mine))
    const get = (file: string) => files.get(file) ?? ''

    expect([...files.keys()].toSorted()).toEqual([
      'client.ts',
      'handlers/health.ts',
      'handlers/index.ts',
      'handlers/notes.ts',
      'handlers/root.ts',
      'handlers/todos.ts',
      'index.ts',
      'routes.ts',
    ])
    // The handlers: theirs as they wrote them, the moved one where they moved it, a stub for the
    // new route, none for the route that is gone.
    const todos = get('handlers/todos.ts')
    expect(todos).toContain('// Mine: the todos of the store.')
    expect(todos).toContain('c.json([...store.values()], 200)')
    expect(todos).toContain('const store = new Map')
    expect(todos).toContain("import { TodoSchema } from '../routes.js'")
    expect(todos).toContain('export const getIndexRouteHandler')
    expect(todos).not.toContain('deleteTodosTodoId')
    expect(get('handlers/root.ts')).not.toContain('getIndexRouteHandler')
    expect(get('handlers/health.ts')).toContain(
      'export const getHealthRouteHandler: RouteHandler<typeof getHealthRoute>',
    )
    expect(get('handlers/index.ts')).toBe(
      "export * from './health.js'\nexport * from './notes.js'\nexport * from './root.js'\nexport * from './todos.js'\n",
    )
    // The app: their set-up, then the routes of the document.
    const index = get('index.ts')
    expect(index).toContain("import { logger } from 'hono/logger'")
    expect(index).toContain('const timing: MiddlewareHandler')
    expect(index).toContain('const app = new Hono().use(logger()).use(timing)')
    expect(index).toMatch(/export const api = app\s*\.openapi\(/u)
    expect(index).toContain('.openapi(getHealthRoute, getHealthRouteHandler)')
    expect(index).not.toContain('deleteTodosTodoId')

    // It type-checks (but for the empty handlers) and runs: the user's handler answers.
    write(files)
    expect(typeErrorsBesidesEmptyHandlers('tsconfig.merge.json')).toEqual([])
    const { default: app } = await import(join(directory, 'index.ts'))
    const todosRes = await app.request('/todos')
    expect(todosRes.status).toBe(200)
    expect(await todosRes.json()).toEqual([])
    // Empty, it answers nothing: behind the app's middleware, Hono's "Context is not finalized" (500).
    const health = await app.request('/health')
    expect(health.status).toBe(500)
    const removed = await app.request('/todos/1', { method: 'DELETE' })
    expect(removed.status).toBe(404)

    // Generating again changes nothing.
    const again = await Effect.runPromise(generate(changed(), config, files))
    for (const [file, code] of again) expect({ file, code }).toEqual({ file, code: files.get(file) })
  })

  it('does not overwrite a file it cannot read', async () => {
    const config = await configOf()
    const exit = await Effect.runPromiseExit(
      generate(document, config, new Map([['index.ts', 'const app = new Hono((']])),
    )
    expect(JSON.stringify(exit)).toContain('cannot be read, so it is not overwritten')
  })
})
