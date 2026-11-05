/**
 * Each operation's type is worked out from its route alone, when it is used: no Hono schema of
 * the whole app.
 */

import type { ClientRequest, ClientResponse, parseResponse } from 'hono/client'

import type { EndpointOf, HonoPath } from './handler.js'
import type { RouteConfig } from './route.js'

/** What is read off a route: a full `RouteConfig` would be compared with every route. */
type RouteLike = { readonly method: string; readonly path: string; readonly responses: object }

/** The routes of `T`: one route, an array of them, or a module of them. */
export type RoutesOf<T> = T extends RouteLike
  ? T
  : T extends readonly (infer R)[]
    ? Extract<R, RouteLike>
    : Extract<T[keyof T], RouteLike>

/** Each route that has an `operationId`, with it: worked out once, not per name looked up. */
type Entries<R> = R extends { readonly operationId: infer Id extends string } ? { name: Id; route: R } : never

/** Hono RPC's request of the route: `hc`'s `client.todos.$get`, as `ClientRequest` types it. */
export type RequestOf<R extends RouteConfig> =
  ClientRequest<'', HonoPath<R['path']>, { [M in R['method'] as `$${M}`]: EndpointOf<R> }> extends infer C
    ? C[`$${R['method']}` & keyof C]
    : never

/** The response of the request: a `ClientResponse` per declared response. */
export type ResponseOf<R extends RouteConfig> = RequestOf<R> extends (...args: never[]) => Promise<infer C> ? C : never

type Parsed<T> = [T] extends [ClientResponse<unknown>] ? Awaited<ReturnType<typeof parseResponse<T>>> : never

/** What a call answers: Hono's `parseResponse()`'s type of its response, as it is. */
export type OperationOutput<R extends RouteConfig> = Parsed<ResponseOf<R>>

/** One operation's call: Hono RPC's request, answering what `parseResponse()` does. */
export type Operation<R extends RouteConfig> = (...args: Parameters<RequestOf<R>>) => Promise<OperationOutput<R>>

/** The client: `client.getTodos({ query: { done: 'false' } })`, by each route's `operationId`. */
export type Client<T> = {
  readonly [E in Entries<RoutesOf<T>> as E['name']]: E['route'] extends RouteConfig ? Operation<E['route']> : never
}
