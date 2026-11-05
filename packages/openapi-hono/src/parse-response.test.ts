/** The type of what an operation's call answers: `parseResponse()`'s, as it is. */

import { Hono } from 'hono'
import { hc } from 'hono/client'
import type { parseResponse } from 'hono/client'
import { describe, expectTypeOf, it } from 'vite-plus/test'
import * as z from 'zod'

import { createClient } from './client.js'
import { createRoute } from './index.js'

const get = createRoute({
  method: 'get',
  path: '/todos/{id}',
  operationId: 'getTodo',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'ok', content: { 'application/json': { schema: z.object({ title: z.string() }) } } },
    404: { description: 'no', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
  },
})
const del = createRoute({
  method: 'delete',
  path: '/todos/{id}',
  operationId: 'deleteTodo',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'ok', content: { 'application/json': { schema: z.object({ id: z.string() }) } } },
    204: { description: 'gone' },
    404: { description: 'no' },
  },
})
const text = createRoute({
  method: 'get',
  path: '/text',
  operationId: 'getText',
  responses: { 200: { description: 'ok', content: { 'text/plain': { schema: z.string() } } } },
})
const api = new Hono()
  .openapi(get, (c) => c.json({ title: 'a' }, 200))
  .openapi(del, (c) => c.body(null, 204))
  .openapi(text, (c) => c.text('a', 200))
const rpc = hc<typeof api>('/')
const client = createClient({ get, del, text }, '/')

describe('what a call of createClient() answers', () => {
  it("is the type Hono's parseResponse() gives the response of hc", () => {
    type P1 = Awaited<ReturnType<typeof parseResponse<Awaited<ReturnType<(typeof rpc.todos)[':id']['$get']>>>>>
    type P2 = Awaited<ReturnType<typeof parseResponse<Awaited<ReturnType<(typeof rpc.todos)[':id']['$delete']>>>>>
    type P3 = Awaited<ReturnType<typeof parseResponse<Awaited<ReturnType<typeof rpc.text.$get>>>>>
    expectTypeOf<Awaited<ReturnType<typeof client.getTodo>>>().toEqualTypeOf<P1>()
    expectTypeOf<Awaited<ReturnType<typeof client.deleteTodo>>>().toEqualTypeOf<P2>()
    expectTypeOf<Awaited<ReturnType<typeof client.getText>>>().toEqualTypeOf<P3>()
  })
})
