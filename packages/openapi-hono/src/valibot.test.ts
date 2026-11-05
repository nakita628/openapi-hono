/** Valibot's schemas as they are, through `createRoute()` from openapi-hono/valibot. */

import * as v from 'valibot'
import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import { Hono } from 'hono'

// openapi-hono/valibot alone: it adds openapi() to Hono's app, as openapi-hono does.
import { createRoute } from './valibot.js'
import type { OpenAPIConfig } from './types/openapi.js'

const TodoSchema = v.object({ id: v.string(), title: v.pipe(v.string(), v.minCodePoints(1)) })

type Category = { name: string; children?: Category[] | undefined }

const CategorySchema: v.GenericSchema<Category> = v.object({
  name: v.string(),
  children: v.optional(v.array(v.lazy(() => CategorySchema))),
})

const getTodoRoute = createRoute({
  method: 'get',
  path: '/todos/{todoId}',
  request: {
    params: v.object({ todoId: v.string() }),
    query: v.object({
      done: v.optional(
        v.pipe(
          v.string(),
          v.regex(/^(?:true|false)$/iu),
          v.transform((text) => text.toLowerCase() === 'true'),
        ),
      ),
    }),
  },
  responses: {
    200: { description: 'The todo', content: { 'application/json': { schema: v.array(TodoSchema) } } },
  },
})

const putTodoRoute = createRoute({
  method: 'put',
  path: '/todos/{todoId}',
  request: {
    params: v.object({ todoId: v.string() }),
    body: { content: { 'application/json': { schema: TodoSchema } } },
  },
  responses: {
    200: { description: 'The todo', content: { 'application/json': { schema: TodoSchema } } },
    201: { description: 'A category', content: { 'application/json': { schema: CategorySchema } } },
  },
})

const app = new Hono()
  .openapi(getTodoRoute, (c) => c.json([{ id: c.req.valid('param').todoId, title: 'Light a fire' }], 200))
  .openapi(putTodoRoute, (c) => c.json(c.req.valid('json'), 200))

const documentOf = (config: Partial<OpenAPIConfig> = {}) =>
  app.getOpenAPIDocument({
    info: { title: 'Todos', version: '1.0.0' },
    components: { schemas: { Todo: TodoSchema, Category: CategorySchema } },
    ...config,
  })

describe("createRoute() from 'openapi-hono/valibot'", () => {
  it("checks with Valibot's schemas as they are, which stay Valibot's", async () => {
    const res = await app.request('/todos/1?done=TRUE')
    expect(await res.json()).toEqual([{ id: '1', title: 'Light a fire' }])
    const bad = await app.request('/todos/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', title: '' }),
    })
    expect(bad.status).toBe(400)
    // The schema is the same one, of its own type, left as it is.
    expect(putTodoRoute.request.body.content['application/json'].schema).toBe(TodoSchema)
    expectTypeOf(putTodoRoute.request.body.content['application/json'].schema).toEqualTypeOf<typeof TodoSchema>()
    expect(TodoSchema['~standard']).not.toHaveProperty('jsonSchema')
  })

  it("writes the document from Valibot's JSON Schema, its components named, a recursive one too", () => {
    const doc = documentOf()
    const get = doc.paths['/todos/{todoId}']?.get as any
    expect(get.responses['200'].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Todo' },
    })
    // A pattern with flags has no JSON Schema: left out.
    expect(get.parameters[1]).toMatchObject({ name: 'done', schema: { type: 'string' } })
    expect(get.parameters[1].schema).not.toHaveProperty('pattern')
    // `minCodePoints` is JSON Schema's `minLength`, which counts code points.
    expect(doc.components?.schemas?.Todo).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string', minLength: 1 } },
      required: ['id', 'title'],
    })
    expect(doc.components?.schemas?.Category).toMatchObject({
      properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Category' } } },
    })
  })

  it('writes a 3.0 document', () => {
    const doc = documentOf({ openapi: '3.0.3' })
    expect(doc.openapi).toBe('3.0.3')
    expect(doc.components?.schemas?.Todo).toMatchObject({ properties: { title: { minLength: 1 } } })
  })

  it("takes the document's libraryOptions over the defaults", () => {
    expect(() => documentOf({ libraryOptions: { overrideAction: () => undefined } })).toThrow(
      'cannot be converted to JSON Schema',
    )
  })
})
