/**
 * `pathAlias`: the generated files import one another under the alias (`@/routes.js`) within the
 * directory of `output`, and relatively from outside it.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Effect } from 'effect'
import { parseOpenAPI } from 'oas-truth'
import type { OpenAPI } from 'oas-truth'
import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { parseConfig } from '../src/config.js'
import type { ConfigInput } from '../src/config.js'
import { generate } from '../src/generate.js'
import { typeErrorsBesidesEmptyHandlers } from './typecheck.js'

const here = import.meta.dirname

let document: OpenAPI

beforeAll(async () => {
  const parsed = await parseOpenAPI(join(here, 'openapi.yaml'))
  if (!parsed.ok) throw new Error(parsed.error)
  document = parsed.value
})

const filesOf = async (input: Partial<ConfigInput>, existing?: ReadonlyMap<string, string>) => {
  const config = await Effect.runPromise(
    parseConfig({ input: 'openapi.yaml', output: 'src/routes.ts', schema: 'zod', template: true, ...input }),
  )
  return Effect.runPromise(generate(document, config, existing))
}

describe('pathAlias', () => {
  it('imports under the alias within the directory of output, and the files type-check with it', async () => {
    const files = await filesOf({ pathAlias: '@/', client: { output: 'src/client.ts', mode: 'hc' } })
    const get = (file: string) => files.get(file) ?? ''
    expect(get('src/handlers/todos.ts')).toContain("} from '@/routes.js'")
    expect(get('src/index.ts')).toContain("} from '@/handlers/index.js'")
    expect(get('src/index.ts')).toContain("} from '@/routes.js'")
    expect(get('src/client.ts')).toContain("import type { api } from '@/index.js'")
    // The barrel's files are its own directory's.
    expect(get('src/handlers/index.ts')).toContain("export * from './todos.js'")
    expect([...files.values()].join('\n')).not.toMatch(/from '\.\.?\/(?!todos|notes|root)/u)

    const directory = join(here, 'generated', 'alias-zod')
    rmSync(directory, { recursive: true, force: true })
    for (const [file, code] of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), code)
    }
    expect(typeErrorsBesidesEmptyHandlers('tsconfig.alias.json')).toEqual([])
  })

  it('imports relatively from a file outside the directory of output', async () => {
    const files = await filesOf({ pathAlias: '@/', client: { output: 'client/index.ts', mode: 'hc' } })
    expect(files.get('client/index.ts')).toContain("import type { api } from '../src/index.js'")
  })

  it('takes over files written with relative imports, keeping the handlers', async () => {
    const before = await filesOf({})
    const todos = (before.get('src/handlers/todos.ts') ?? '').replace(
      'export const getTodosRouteHandler: RouteHandler<typeof getTodosRoute> = async (c) => {}',
      'export const getTodosRouteHandler: RouteHandler<typeof getTodosRoute> = (c) => c.json([], 200)',
    )
    const after = await filesOf({ pathAlias: '@/' }, new Map([...before, ['src/handlers/todos.ts', todos]]))
    const merged = after.get('src/handlers/todos.ts') ?? ''
    expect(merged).toContain('(c) => c.json([], 200)')
    expect(merged).toContain("} from '@/routes.js'")
    expect(merged).not.toContain('../routes.js')
    expect(after.get('src/index.ts')).not.toContain('./routes.js')
  })
})
