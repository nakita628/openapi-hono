/**
 * The same operations with each validation library: the app checks the request and the response
 * through Standard Schema (`~standard.validate`), and writes the document through Standard JSON
 * Schema (`~standard.jsonSchema`), so swapping the library changes nothing else.
 */

import { type } from 'arktype'
import { Schema } from 'effect'
import * as v from 'valibot'
import { describe, expect, it, test } from 'vite-plus/test'
import * as z from 'zod'

import { Hono } from 'hono'

import { createRoute, getOpenAPIDocument } from './index.js'
// oxlint-disable-next-line import/no-unassigned-import -- registers the conversion of Valibot's schemas
import './valibot.js'
import type { RouteHandler, RouteSchema } from './index.js'

type Library = {
  readonly params: RouteSchema
  readonly body: RouteSchema
  readonly todo: RouteSchema
}

// Effect's schema checks through toStandardSchemaV1, and has its JSON Schema through toStandardJSONSchemaV1: both.
const effect = <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema))

const libraries: Record<string, Library> = {
  zod: {
    params: z.object({ todoId: z.string() }),
    body: z.object({ title: z.string().min(1) }),
    todo: z.object({ id: z.string(), title: z.string() }),
  },
  // Valibot's as they are: openapi-hono/valibot (imported below) writes their JSON Schema.
  valibot: {
    params: v.object({ todoId: v.string() }),
    body: v.object({ title: v.pipe(v.string(), v.minLength(1)) }),
    todo: v.object({ id: v.string(), title: v.string() }),
  },
  arktype: {
    params: type({ todoId: 'string' }),
    body: type({ title: 'string > 0' }),
    todo: type({ id: 'string', title: 'string' }),
  },
  effect: {
    params: effect(Schema.Struct({ todoId: Schema.String })),
    body: effect(Schema.Struct({ title: Schema.NonEmptyString })),
    todo: effect(Schema.Struct({ id: Schema.String, title: Schema.String })),
  },
}

const appOf = (library: Library) => {
  const putTodoRoute = createRoute({
    method: 'put',
    path: '/todos/{todoId}',
    request: {
      params: library.params,
      body: { required: true, content: { 'application/json': { schema: library.body } } },
    },
    responses: { 200: { description: 'The todo', content: { 'application/json': { schema: library.todo } } } },
  })
  const putTodoRouteHandler: RouteHandler<typeof putTodoRoute> = (c) => {
    const { todoId } = c.req.valid('param') as { todoId: string }
    const { title } = c.req.valid('json') as { title: string }
    // `bad` answers a body that does not match the route.
    return c.json(todoId === 'bad' ? { id: 1 } : { id: todoId, title }, 200)
  }
  return new Hono().openapi(putTodoRoute, putTodoRouteHandler)
}

const put = (path: string, body: unknown) =>
  ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as const

describe.each(Object.entries(libraries))('with %s', (_name, library) => {
  const app = appOf(library)

  it('passes a request that matches, and its response', async () => {
    const res = await app.request('/todos/1', put('/todos/1', { title: 'Light a fire' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '1', title: 'Light a fire' })
  })

  it('answers a request that does not match with a 400, as @hono/standard-validator does', async () => {
    const res = await app.request('/todos/1', put('/todos/1', { title: '' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ data: { title: '' }, success: false })
    expect(body.error).toEqual([expect.objectContaining({ message: expect.any(String) })])
  })

  it('answers a response that does not match with a 500', async () => {
    const res = await app.request('/todos/bad', put('/todos/bad', { title: 'x' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Response validation failed' })
  })

  it('writes the document', () => {
    const doc = getOpenAPIDocument(app, { info: { title: 'Todos', version: '1.0.0' } })
    const operation = doc.paths['/todos/{todoId}']?.put as any
    expect(operation.parameters).toEqual([
      { name: 'todoId', in: 'path', required: true, schema: expect.objectContaining({ type: 'string' }) },
    ])
    expect(operation.requestBody.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { title: expect.objectContaining({ type: 'string' }) },
      required: ['title'],
    })
    expect(operation.responses['200'].content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['id', 'title'],
    })
    expect(operation.responses).not.toHaveProperty('400')
  })

  it('writes a 3.0 document, as the library writes 3.0 or turned into it', () => {
    const doc = getOpenAPIDocument(app, { openapi: '3.0.3', info: { title: 'Todos', version: '1.0.0' } })
    const operation = doc.paths['/todos/{todoId}']?.put as any
    expect(operation.requestBody.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { title: expect.objectContaining({ type: 'string' }) },
    })
    expect(JSON.stringify(doc)).not.toContain('$schema')
  })
})

describe('a 3.0 document', () => {
  const documentOf = (schema: RouteSchema) => {
    const route = createRoute({
      method: 'get',
      path: '/item',
      responses: { 200: { description: 'ok', content: { 'application/json': { schema } } } },
    })
    const app = new Hono().openapi(route, (c) => c.json({}, 200))
    const doc = getOpenAPIDocument(app, { openapi: '3.0.3', info: { title: 'x', version: '1' } })
    const operation = doc.paths['/item']?.get as any
    return operation.responses['200'].content['application/json'].schema
  }

  it("is written by Zod's own target: 'openapi-3.0' (a tuple with its length)", () => {
    expect(documentOf(z.object({ pair: z.tuple([z.string(), z.number()]) })).properties.pair).toEqual({
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      minItems: 2,
      maxItems: 2,
    })
  })

  it("is written by Valibot's own, and turned from 2020-12 for an action Valibot has no 3.0 of", () => {
    const own = documentOf(v.object({ note: v.nullable(v.string()) }))
    expect(own.properties.note).toEqual({ type: 'string', nullable: true })
    const turned = documentOf(v.object({ n: v.pipe(v.number(), v.gtValue(1)) }))
    expect(turned.properties.n).toEqual({ type: 'number', minimum: 1, exclusiveMinimum: true })
  })

  it('is turned from 2020-12 for a library that has no 3.0 (ArkType, Effect)', () => {
    expect(documentOf(type({ note: 'string | null' })).properties.note).toEqual({ type: 'string', nullable: true })
    const note = documentOf(effect(Schema.Struct({ note: Schema.NullOr(Schema.String) }))).properties.note
    expect(note).toEqual({ type: 'string', nullable: true })
  })
})

test("throws for a schema that cannot check: Effect's toStandardJSONSchemaV1 alone", () => {
  const route = createRoute({
    method: 'get',
    path: '/todos/{todoId}',
    request: { params: Schema.toStandardJSONSchemaV1(Schema.Struct({ todoId: Schema.String })) },
    responses: { 200: { description: 'ok' } },
  })
  expect(() => new Hono().openapi(route, (c) => c.body(null, 200))).toThrow(
    'GET /todos/{todoId} params: the schema has no ~standard.validate',
  )
})
