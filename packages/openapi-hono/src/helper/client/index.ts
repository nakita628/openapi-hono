import { hc, parseResponse } from 'hono/client'
import type { ClientRequestOptions, ClientResponse } from 'hono/client'

import type { Client } from '../../types/client.js'
import type { RuntimeRoute } from '../../types/validation.js'
import { isObject } from '../../utils/object.js'
import { honoPathOf } from '../../utils/path.js'
import { listRoutes } from '../../utils/route.js'

type Call = (args?: unknown, options?: ClientRequestOptions) => Promise<unknown>

type RpcCall = (args: unknown, options?: ClientRequestOptions) => Promise<ClientResponse<unknown>>

/** `hc`'s proxy hands a function for every key, so a function at `$method` is its call. */
const isRpcCall = (value: unknown): value is RpcCall => typeof value === 'function'

/** The segments `hc` is walked by: `/todos/{todoId}` is `todos`, `:todoId`; `/` is `index`. */
const segmentsOf = (path: string) => [
  ...honoPathOf(path)
    .split('/')
    .filter((segment) => segment !== ''),
  ...(path.replace(/\/+$/u, '') === '' ? ['index'] : []),
]

function operationsOf(routes: unknown): ReadonlyMap<string, RuntimeRoute> {
  const operations = new Map<string, RuntimeRoute>()
  for (const route of listRoutes(routes)) {
    const id = 'operationId' in route ? route.operationId : undefined
    if (typeof id !== 'string') continue
    const other = operations.get(id)
    if (other !== undefined) {
      throw new TypeError(
        `The operationId "${id}" is used by both ${other.method.toUpperCase()} ${other.path} and ` +
          `${route.method.toUpperCase()} ${route.path}`,
      )
    }
    operations.set(id, route)
  }
  return operations
}

/** The client of the routes (one, an array, or a module of them), at `baseUrl`. */
export function createClient<const T>(routes: T, baseUrl: string, options?: ClientRequestOptions): Client<T> {
  const rpc: unknown = hc(baseUrl, options)
  // No prototype: an operationId such as `toString` is the client's own key, and nothing else is.
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- Object.create is typed `any`
  const client: Record<string, Call> = Object.create(null)
  for (const [id, route] of operationsOf(routes)) {
    // `hc`'s proxy is a function, which isObject takes, at every key.
    const node = segmentsOf(route.path).reduce<unknown>(
      (parent, segment) => (isObject(parent) ? parent[segment] : undefined),
      rpc,
    )
    const call = isObject(node) ? node[`$${route.method.toLowerCase()}`] : undefined
    if (!isRpcCall(call)) throw new TypeError(`hc has no call for ${route.method.toUpperCase()} ${route.path}`)
    client[id] = (args, callOptions) => parseResponse(call(args ?? {}, callOptions))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
  return Object.freeze(client) as unknown as Client<T>
}
