import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import * as z from 'zod'

import type { parseResponse } from 'hono/client'
import { hc } from 'hono/client'

import { createClient, DetailedError } from './client.js'
import { Hono } from 'hono'

import { createRoute, schema } from './index.js'
import type { RouteHandler } from './index.js'

const TodoSchema = z.object({ id: z.string(), title: z.string(), done: z.boolean() })
type Todo = z.infer<typeof TodoSchema>

const NotFoundResponse = {
  description: 'No such todo',
  content: { 'application/json': { schema: z.object({ message: z.string() }) } },
}

// The routes module: what the client imports.
const routes = {
  getIndexRoute: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getIndex',
    responses: { 200: { description: 'ok', content: { 'text/plain': { schema: schema<string>() } } } },
  }),
  getTodosRoute: createRoute({
    method: 'get',
    path: '/todos',
    operationId: 'getTodos',
    request: { query: z.object({ done: z.enum(['true', 'false']).optional() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(TodoSchema) } } } },
  }),
  postTodosRoute: createRoute({
    method: 'post',
    path: '/todos',
    operationId: 'postTodos',
    request: {
      body: { required: true, content: { 'application/json': { schema: z.object({ title: z.string().min(1) }) } } },
    },
    responses: { 201: { description: 'Created', content: { 'application/json': { schema: TodoSchema } } } },
  }),
  getTodosTodoIdRoute: createRoute({
    method: 'get',
    path: '/todos/{todoId}',
    operationId: 'getTodosTodoId',
    request: { params: z.object({ todoId: z.string() }) },
    responses: {
      200: { description: 'The todo', content: { 'application/json': { schema: TodoSchema } } },
      404: NotFoundResponse,
    },
  }),
  deleteTodosTodoIdRoute: createRoute({
    method: 'delete',
    path: '/todos/{todoId}',
    operationId: 'deleteTodosTodoId',
    responses: { 204: { description: 'Deleted' }, 404: NotFoundResponse },
  }),
  // No operationId: not on the client.
  getHealthRoute: createRoute({ method: 'get', path: '/health', responses: { 200: { description: 'ok' } } }),
}

const todos = new Map<string, Todo>([['1', { id: '1', title: 'Light a fire', done: false }]])

const getTodosTodoId: RouteHandler<typeof routes.getTodosTodoIdRoute> = (c) => {
  const todo = todos.get(c.req.valid('param').todoId)
  return todo === undefined ? c.json({ message: 'Not found' }, 404) : c.json(todo, 200)
}

const app = new Hono()
  .openapi(routes.getIndexRoute, (c) => c.text('takibi', 200))
  .openapi(routes.getTodosRoute, (c) => {
    const { done } = c.req.valid('query')
    return c.json(
      [...todos.values()].filter((todo) => done === undefined || String(todo.done) === done),
      200,
    )
  })
  .openapi(routes.postTodosRoute, (c) => {
    const todo = { id: String(todos.size + 1), title: c.req.valid('json').title, done: false }
    todos.set(todo.id, todo)
    return c.json(todo, 201)
  })
  .openapi(routes.getTodosTodoIdRoute, getTodosTodoId)
  .openapi(routes.deleteTodosTodoIdRoute, (c) =>
    todos.delete(c.req.param('todoId')) ? c.body(null, 204) : c.json({ message: 'Not found' }, 404),
  )

const client = createClient(routes, 'http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
})

describe('createClient()', () => {
  it('calls each operation by its operationId, with Hono RPC arguments, and parses the response', async () => {
    expect(await client.getIndex()).toBe('takibi')
    const created = await client.postTodos({ json: { title: 'Bring wood' } })
    expect(created).toEqual({ id: '2', title: 'Bring wood', done: false })
    expect(await client.getTodos()).toHaveLength(2)
    expect(await client.getTodos({ query: { done: 'false' } })).toHaveLength(2)
    expect(await client.getTodosTodoId({ param: { todoId: '2' } })).toEqual(created)
    await expect(client.deleteTodosTodoId({ param: { todoId: '2' } })).resolves.toBeUndefined()
    expect(Object.keys(client)).toEqual(['getIndex', 'getTodos', 'postTodos', 'getTodosTodoId', 'deleteTodosTodoId'])
  })

  it("throws Hono's DetailedError for a response that is not ok, as parseResponse() does", async () => {
    const error = await client.getTodosTodoId({ param: { todoId: '9' } }).catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(DetailedError)
    if (error instanceof DetailedError && error.statusCode === 404) {
      expect(error.detail.data).toEqual({ message: 'Not found' })
    }
    const invalid = await client.postTodos({ json: { title: '' } }).catch((error_: unknown) => error_)
    expect(invalid).toBeInstanceOf(DetailedError)
    expect(invalid instanceof DetailedError ? invalid.statusCode : undefined).toBe(400)
  })

  it('throws for an operationId used twice', () => {
    const a = createRoute({ method: 'get', path: '/a', operationId: 'same', responses: { 200: { description: 'ok' } } })
    const b = createRoute({ method: 'get', path: '/b', operationId: 'same', responses: { 200: { description: 'ok' } } })
    expect(() => createClient([a, b], 'http://localhost')).toThrow(
      'The operationId "same" is used by both GET /a and GET /b',
    )
  })
})

describe('the types', () => {
  it('types the arguments and what each call answers', () => {
    expectTypeOf(client.getTodos)
      .parameter(0)
      .toEqualTypeOf<{ query?: { done?: 'true' | 'false' | undefined } } | undefined>()
    expectTypeOf(client.getTodosTodoId).parameter(0).toEqualTypeOf<{ param: { todoId: string } }>()
    expectTypeOf(client.deleteTodosTodoId).parameter(0).toEqualTypeOf<{ param: { todoId: string } }>()
    expectTypeOf(client.getTodos).returns.resolves.toEqualTypeOf<Todo[]>()
    expectTypeOf(client.getTodosTodoId).returns.resolves.toEqualTypeOf<Todo>()
    expectTypeOf(client.deleteTodosTodoId).returns.resolves.toEqualTypeOf<undefined>()
    expectTypeOf(client.getIndex).returns.resolves.toEqualTypeOf<string>()
    // @ts-expect-error: no operationId
    void client.getHealth
  })

  it("is Hono's: hc's request of the operation, and what parseResponse() answers for it", () => {
    const rpc = hc<typeof app>('http://localhost')
    const request = rpc.todos[':todoId'].$get
    expectTypeOf(client.getTodosTodoId).parameters.toEqualTypeOf<Parameters<typeof request>>()
    type Answered = Awaited<ReturnType<typeof parseResponse<Awaited<ReturnType<typeof request>>>>>
    expectTypeOf(client.getTodosTodoId).returns.resolves.toEqualTypeOf<Answered>()
  })
})
