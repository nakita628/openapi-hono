import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { Hono } from 'hono'
import { hc } from 'hono/client'
import * as v from 'valibot'
import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import * as z from 'zod'

import { createRoute, getOpenAPIDocument, schema } from './index.js'
import type { RouteHandler } from './index.js'

// --- the routes, each with its handler declared apart --------------------------------------

const TodoSchema = z.object({ id: z.string(), title: z.string(), done: z.boolean() })
type Todo = z.infer<typeof TodoSchema>

const getTodosRoute = createRoute({
  method: 'get',
  path: '/todos',
  operationId: 'getTodos',
  request: { query: z.object({ done: z.enum(['true', 'false']).optional() }) },
  responses: { 200: { description: 'The todos', content: { 'application/json': { schema: z.array(TodoSchema) } } } },
  components: { TodoSchema },
})

const postTodosRoute = createRoute({
  method: 'post',
  path: '/todos',
  request: {
    body: { required: true, content: { 'application/json': { schema: z.object({ title: z.string().min(1) }) } } },
  },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: TodoSchema } } } },
})

const getTodosTodoIdRoute = createRoute({
  method: 'get',
  path: '/todos/{todoId}',
  request: { params: z.object({ todoId: z.string() }) },
  responses: {
    200: { description: 'The todo', content: { 'application/json': { schema: TodoSchema } } },
    404: {
      description: 'No such todo',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
  },
})

const patchTodosTodoIdRoute = createRoute({
  method: 'patch',
  path: '/todos/{todoId}',
  request: {
    params: toStandardJsonSchema(v.object({ todoId: v.string() })),
    body: { content: { 'application/json': { schema: toStandardJsonSchema(v.object({ done: v.boolean() })) } } },
  },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: TodoSchema } } } },
})

const deleteTodosTodoIdRoute = createRoute({
  method: 'delete',
  path: '/todos/{todoId}',
  responses: { 204: { description: 'Deleted' } },
})

const todos = new Map<string, Todo>([['1', { id: '1', title: 'Light a fire', done: false }]])

const getTodosRouteHandler: RouteHandler<typeof getTodosRoute> = (c) => {
  const { done } = c.req.valid('query')
  const list = [...todos.values()]
  return c.json(done === undefined ? list : list.filter((todo) => String(todo.done) === done), 200)
}

const postTodosRouteHandler: RouteHandler<typeof postTodosRoute> = (c) => {
  const { title } = c.req.valid('json')
  const todo = { id: String(todos.size + 1), title, done: false }
  todos.set(todo.id, todo)
  return c.json(todo, 201)
}

const getTodosTodoIdRouteHandler: RouteHandler<typeof getTodosTodoIdRoute> = (c) => {
  const todo = todos.get(c.req.valid('param').todoId)
  return todo === undefined ? c.json({ message: 'Not found' }, 404) : c.json(todo, 200)
}

const patchTodosTodoIdRouteHandler: RouteHandler<typeof patchTodosTodoIdRoute> = (c) => {
  const todo = todos.get(c.req.valid('param').todoId)
  if (todo === undefined) throw new Error('the todo to patch is in the store')
  const updated = { ...todo, done: c.req.valid('json').done }
  todos.set(todo.id, updated)
  return c.json(updated, 200)
}

const deleteTodosTodoIdRouteHandler: RouteHandler<typeof deleteTodosTodoIdRoute> = (c) => {
  todos.delete(c.req.param('todoId'))
  return c.body(null, 204)
}

const app = new Hono()

export const api = app
  .openapi(getTodosRoute, getTodosRouteHandler)
  .openapi(postTodosRoute, postTodosRouteHandler)
  .openapi(getTodosTodoIdRoute, getTodosTodoIdRouteHandler)
  .openapi(patchTodosTodoIdRoute, patchTodosTodoIdRouteHandler)
  .openapi(deleteTodosTodoIdRoute, deleteTodosTodoIdRouteHandler)
  .doc('/doc', { info: { title: 'Todos', version: '1.0.0' } })

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('app.openapi()', () => {
  it('serves each operation at its path template, with the values checked', async () => {
    const res = await api.request('/todos?done=false')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: '1', title: 'Light a fire', done: false }])
    const created = await api.request('/todos', json({ title: 'Bring wood' }))
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ id: '2', title: 'Bring wood', done: false })
    const missing = await api.request('/todos/9')
    expect(missing.status).toBe(404)
    const patched = await api.request('/todos/2', { ...json({ done: true }), method: 'PATCH' })
    expect(await patched.json()).toMatchObject({ id: '2', done: true })
    const deleted = await api.request('/todos/2', { method: 'DELETE' })
    expect(deleted.status).toBe(204)
  })

  it('answers a part that does not match as @hono/standard-validator does: 400 { data, error, success: false }', async () => {
    const res = await api.request('/todos?done=maybe')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      data: { done: 'maybe' },
      error: [expect.objectContaining({ message: expect.any(String), path: ['done'] })],
      success: false,
    })
    const valibot = await api.request('/todos/1', { ...json({ done: 'yes' }), method: 'PATCH' })
    expect(valibot.status).toBe(400)
    const valibotBody = await valibot.json()
    expect(valibotBody.data).toEqual({ done: 'yes' })
    expect(valibotBody.error[0].message).toEqual(expect.any(String))
  })

  it('answers the first part that does not match, one part after another, the cookie header left out', async () => {
    const route = createRoute({
      method: 'post',
      path: '/parts/{id}',
      request: {
        params: z.object({ id: z.string().regex(/^\d+$/u) }),
        headers: z.object({ 'x-version': z.string() }),
        body: { content: { 'application/json': { schema: z.object({ title: z.string() }) } } },
      },
      responses: { 200: { description: 'ok' } },
    })
    const parts = new Hono().openapi(route, (c) => c.body(null, 200))
    // The path and the body do not match: the path, checked first, answers.
    const first = await parts.request('/parts/x', json({}))
    const firstBody = await first.json()
    expect(firstBody.data).toEqual({ id: 'x' })
    // The headers, without the cookie.
    const header = await parts.request('/parts/1', {
      ...json({ title: 't' }),
      headers: { 'Content-Type': 'application/json', Cookie: 'session=secret' },
    })
    const headerBody = await header.json()
    expect(headerBody.error[0].path).toEqual(['x-version'])
    expect(headerBody.data).not.toHaveProperty('cookie')
    expect(JSON.stringify(headerBody)).not.toContain('secret')
  })

  it("reads a body of another media type, or none, as {}, as Hono does, and malformed JSON is Hono's 400", async () => {
    const missing = await api.request('/todos', { method: 'POST' })
    expect(missing.status).toBe(400)
    const missingBody = await missing.json()
    expect(missingBody.data).toEqual({})
    expect(missingBody.error[0].path).toEqual(['title'])
    const text = await api.request('/todos', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
    expect(text.status).toBe(400)
    const malformed = await api.request('/todos', { ...json(null), body: '{' })
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).toBe('Malformed JSON in request body')
  })

  it('answers a JSON response that does not match with a 500, and one that matches with the output', async () => {
    const route = createRoute({
      method: 'get',
      path: '/out/{n}',
      request: { params: z.object({ n: z.string() }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ n: z.string().transform((n) => n.length) }) } },
        },
      },
    })
    const handler: RouteHandler<typeof route> = (c) => {
      const { n } = c.req.valid('param')
      return c.json({ n: n === 'bad' ? (1 as unknown as string) : n }, 200)
    }
    const out = new Hono().openapi(route, handler)
    const ok = await out.request('/out/abc')
    expect(await ok.json()).toEqual({ n: 3 })
    const bad = await out.request('/out/bad')
    expect(bad.status).toBe(500)
    expect(await bad.json()).toEqual({ error: 'Response validation failed' })
    const unchecked = new Hono().openapi(route, handler, { validateResponse: false })
    const passed = await unchecked.request('/out/bad')
    expect(await passed.json()).toEqual({ n: 1 })
  })

  it('reads back and checks a JSON response made without a status, after c.status()', async () => {
    const route = createRoute({
      method: 'get',
      path: '/status/{n}',
      request: { params: z.object({ n: z.string() }) },
      responses: {
        201: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ n: z.string().transform((n) => n.length) }) } },
        },
      },
    })
    const statused = new Hono().openapi(route, ((c: any) => {
      c.status(201)
      const { n } = c.req.valid('param')
      return c.json({ n: n === 'bad' ? 1 : n })
    }) as RouteHandler<typeof route>)
    const ok = await statused.request('/status/abc')
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ n: 3 })
    const bad = await statused.request('/status/bad')
    expect(bad.status).toBe(500)
  })

  it('checks a response made by c.json(value, status) as it is made, in an async handler', async () => {
    const route = createRoute({
      method: 'get',
      path: '/later',
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      },
    })
    const later = new Hono().openapi(route, async (c) => {
      await Promise.resolve()
      return c.json({ ok: 'yes' as unknown as boolean }, 200)
    })
    const res = await later.request('/later')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Response validation failed' })
  })

  it("leaves an optional body that was not sent unchecked, and gives the schema's output", async () => {
    const route = createRoute({
      method: 'post',
      path: '/count',
      request: {
        query: z.object({ n: z.coerce.number() }),
        body: { required: false, content: { 'application/json': { schema: z.object({ x: z.string() }) } } },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: z.object({ n: z.number() }) } } },
      },
    })
    const counted = new Hono().openapi(route, (c) => c.json({ n: c.req.valid('query').n + 1 }, 200))
    const res = await counted.request('/count?n=1', { method: 'POST' })
    expect(await res.json()).toEqual({ n: 2 })
  })

  it('lets a TypeScript type through unchecked, and reads a form', async () => {
    const route = createRoute({
      method: 'post',
      path: '/notes',
      request: {
        body: { content: { 'application/x-www-form-urlencoded': { schema: schema<{ text: string }>() } } },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: schema<{ text: string }>() } } },
      },
    })
    const notes = new Hono().openapi(route, (c) => c.json({ text: c.req.valid('form').text }, 200))
    const res = await notes.request('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=hi',
    })
    expect(await res.json()).toEqual({ text: 'hi' })
  })

  it('answers what a hook returns instead of the 400, and runs the route middleware first', async () => {
    const order: string[] = []
    const route = createRoute({
      method: 'get',
      path: '/hooked/{id}',
      request: { params: z.object({ id: z.string().regex(/^\d+$/u) }) },
      middleware: async (_c, next) => {
        order.push('middleware')
        return next()
      },
      responses: { 200: { description: 'ok' } },
    })
    const hooked = new Hono().openapi(route, (c) => c.text('ok', 200), {
      hook: (result, c) => (result.success ? undefined : c.json({ target: result.target }, 422)),
    })
    const res = await hooked.request('/hooked/x')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ target: 'param' })
    expect(order).toEqual(['middleware'])
  })
})

describe('the document', () => {
  it('is served at app.doc(), with the responses each route declares and no other', async () => {
    const res = await api.request('/doc')
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(Object.keys(doc.paths)).toEqual(['/todos', '/todos/{todoId}'])
    expect(Object.keys(doc.paths['/todos/{todoId}'])).toEqual(['get', 'patch', 'delete'])
    expect(doc.paths['/todos'].get.operationId).toBe('getTodos')
    // The 400 of the check is answered, but not written: the route does not declare it.
    expect(doc.paths['/todos'].get.responses).not.toHaveProperty('400')
    expect(doc.components).not.toHaveProperty('responses')
    expect(doc.components.schemas).toHaveProperty('Todo')
    expect(doc.paths['/todos'].post.responses['201'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Todo',
    })
  })

  it('describes the operations of a mounted app and of basePath(), at the path they are served at', () => {
    const v1 = new Hono().basePath('/v1').openapi(getTodosTodoIdRoute, getTodosTodoIdRouteHandler)
    const root = new Hono().openapi(deleteTodosTodoIdRoute, deleteTodosTodoIdRouteHandler)
    root.route('/api', v1)
    const doc = getOpenAPIDocument(root, { info: { title: 'x', version: '1' } })
    expect(Object.keys(doc.paths)).toEqual(['/todos/{todoId}', '/api/v1/todos/{todoId}'])
  })

  it('leaves out a hidden operation', () => {
    const hidden = createRoute({
      method: 'get',
      path: '/secret',
      hide: true,
      responses: { 200: { description: 'ok' } },
    })
    const secret = new Hono().openapi(hidden, (c) => c.text('shh', 200))
    const doc = getOpenAPIDocument(secret, { info: { title: 'x', version: '1' } })
    expect(doc.paths).toEqual({})
  })
})

describe('the types', () => {
  it('types the values the handler reads', () => {
    const _handler: RouteHandler<typeof patchTodosTodoIdRoute> = (c) => {
      expectTypeOf(c.req.valid('param')).toEqualTypeOf<{ todoId: string }>()
      expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ done: boolean }>()
      return c.json({ id: '1', title: 't', done: true }, 200)
    }
  })

  // oxlint-disable-next-line vitest/expect-expect -- the assertions are the `@ts-expect-error`s, checked by the type check
  it('allows only the statuses and bodies the route declares', () => {
    // @ts-expect-error: 500 is not declared
    const _status: RouteHandler<typeof getTodosTodoIdRoute> = (c) => c.json({ message: 'x' }, 500)
    // @ts-expect-error: the body of 200 is a Todo
    const _body: RouteHandler<typeof getTodosTodoIdRoute> = (c) => c.json({ message: 'x' }, 200)
  })

  it("types Hono's own app, which hc<typeof api>() reads", () => {
    const client = hc<typeof api>('http://localhost')
    expectTypeOf(client.todos[':todoId'].$get).parameter(0).toEqualTypeOf<{ param: { todoId: string } }>()
    expectTypeOf(client.todos.$post).parameter(0).toExtend<{ json: { title: string } }>()
  })
})
