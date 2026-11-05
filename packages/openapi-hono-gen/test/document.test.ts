/**
 * The document of the generated app, with the user's config, with each schema library, from a 3.1 and a 3.0
 * input: a valid OpenAPI document, with the operations of the input.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import SwaggerParser from '@apidevtools/swagger-parser'
import { Effect } from 'effect'
import { parseOpenAPI } from 'oas-truth'
import { describe, expect, it } from 'vite-plus/test'

import { parseConfig } from '../src/config.js'
import { generate } from '../src/generate.js'

const here = import.meta.dirname

/** The document of the app generated from the input with the library. */
async function documentOf(input: string, library: string) {
  const parsed = await parseOpenAPI(join(here, input))
  if (!parsed.ok) throw new Error(parsed.error)
  const config = await Effect.runPromise(parseConfig({ input, output: 'routes.ts', schema: library, template: true }))
  const directory = join(here, 'generated', `document-${library}-${input.replace('.yaml', '')}`)
  for (const [file, code] of await Effect.runPromise(generate(parsed.value, config))) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), code)
  }
  const { default: app } = await import(join(directory, 'index.ts'))
  // The config is the user's: the components are named by the routes.
  const info = { title: 'Todos', version: '1.0.0' }
  return app.getOpenAPIDocument(input === 'openapi30.yaml' ? { openapi: '3.0.3', info } : { info })
}

describe.each(['openapi.yaml', 'openapi30.yaml'])('from %s', (input) => {
  it.each(['zod', 'valibot', 'arktype', 'effect'])('is a valid document with %s', async (library) => {
    const doc = await documentOf(input, library)
    expect(doc.openapi).toBe(input === 'openapi.yaml' ? '3.1.0' : '3.0.3')
    await expect(SwaggerParser.validate(structuredClone(doc))).resolves.toBeDefined()
    expect(Object.keys(doc.paths)).toEqual(['/', '/todos', '/todos/{todoId}', '/notes'])
    expect(Object.keys(doc.paths['/todos/{todoId}'])).toEqual(['get', 'delete'])
    expect(doc.paths['/todos'].get.parameters.map((p: { name: string; in: string }) => `${p.in} ${p.name}`)).toEqual([
      'query done',
      'query limit',
      'header x-request-id',
    ])
  })
})
