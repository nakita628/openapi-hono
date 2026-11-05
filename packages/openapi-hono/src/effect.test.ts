/** Effect's schemas as they are, through `createRoute()` from openapi-hono/effect. */

import { Schema } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import { createClient } from './client.js'
import { createRoute } from './effect.js'
import { Hono } from 'hono'

import { createRoute as createPlainRoute, getOpenAPIDocument } from './index.js'
import type { RouteHandler } from './index.js'

const ItemSchema = Schema.Struct({ id: Schema.String, count: Schema.Number })

const NotFoundResponse = {
  description: 'No such item',
  content: { 'application/json': { schema: Schema.Struct({ message: Schema.String }) } },
}

const getItemRoute = createRoute({
  method: 'get',
  path: '/items/{id}',
  operationId: 'getItem',
  // `FiniteFromString`: a string on the wire, a number in the handler.
  request: {
    params: Schema.Struct({ id: Schema.String }),
    query: Schema.Struct({ times: Schema.optional(Schema.FiniteFromString) }),
  },
  responses: {
    200: { description: 'The item', content: { 'application/json': { schema: ItemSchema } } },
    404: NotFoundResponse,
  },
  components: { ItemSchema, NotFoundResponse },
})

const getItemRouteHandler: RouteHandler<typeof getItemRoute> = (c) => {
  const { id } = c.req.valid('param')
  const { times } = c.req.valid('query')
  expectTypeOf(times).toEqualTypeOf<number | undefined>()
  return id === '0' ? c.json({ message: 'Not found' }, 404) : c.json({ id, count: (times ?? 1) * 2 }, 200)
}

const app = new Hono().openapi(getItemRoute, getItemRouteHandler)

describe("createRoute() from 'openapi-hono/effect'", () => {
  it("checks with Effect's schemas as they are, and gives their decoded values", async () => {
    const ok = await app.request('/items/a?times=3')
    expect(await ok.json()).toEqual({ id: 'a', count: 6 })
    const bad = await app.request('/items/a?times=x')
    expect(bad.status).toBe(400)
    const body = await bad.json()
    // Effect's issues have no kind of their own: pydantic's generic one.
    expect(body).toMatchObject({ data: { times: 'x' }, success: false })
    expect(body.error[0].path).toEqual(['times'])
  })

  it('writes the document, with the components named', () => {
    const doc = getOpenAPIDocument(app, { info: { title: 'Items', version: '1' } }) as any
    expect(Object.keys(doc.components.schemas).sort()).toEqual(['Item'])
    const responses = doc.paths['/items/{id}'].get.responses
    expect(responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Item' })
    expect(responses['404']).toEqual({ $ref: '#/components/responses/NotFound' })
    expect(doc.paths['/items/{id}'].get.parameters[1]).toMatchObject({ name: 'times', in: 'query', required: false })
  })

  it('types the client by the encoded side: what is sent', async () => {
    const client = createClient({ getItemRoute }, 'http://localhost', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    })
    expectTypeOf(client.getItem)
      .parameter(0)
      .toEqualTypeOf<{ param: { readonly id: string }; query?: { readonly times?: string | undefined } }>()
    expect(await client.getItem({ param: { id: 'b' }, query: { times: '2' } })).toEqual({ id: 'b', count: 4 })
  })

  it("throws for an Effect schema given to openapi-hono's own createRoute()", () => {
    const route = createPlainRoute({
      method: 'get',
      path: '/plain',
      // @ts-expect-error: not a Standard Schema
      request: { query: Schema.Struct({ q: Schema.String }) },
      responses: { 200: { description: 'ok' } },
    })
    expect(() => new Hono().openapi(route, (c) => c.body(null, 200))).toThrow(
      "GET /plain query: an Effect schema is not a Standard Schema as it is. Declare the route with createRoute() from 'openapi-hono/effect'",
    )
  })
})
