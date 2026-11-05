/**
 * Each schema is converted once, wherever it is used, so that a schema named in `components`
 * is the one the routes use. The objects of the route (a response shared by routes, say) have
 * their schemas replaced in place, so that they stay the objects `components` names.
 */

import { Schema } from 'effect'
import type { MiddlewareHandler } from 'hono'

import type { Method, RouteSchema } from '../../types/route.js'
import { isObject } from '../../utils/object.js'
import { createRoute as createBase } from '../route/index.js'

/** An Effect schema, as the route's types read it: its `Type` and `Encoded`. */
type EffectSchema = { readonly ast: object; readonly Type: unknown; readonly Encoded: unknown }

type Slot = RouteSchema | EffectSchema

type Content = { readonly [mediaType: string]: { readonly schema?: Slot; readonly [key: string]: unknown } }

/** A route as `createRoute()` takes it, with Effect's schemas in its schema slots. */
export type EffectRouteConfig = {
  readonly method: Method
  readonly path: string
  readonly request?: {
    readonly params?: Slot
    readonly query?: Slot
    readonly headers?: Slot
    readonly cookies?: Slot
    readonly body?: { readonly required?: boolean; readonly content: Content; readonly [key: string]: unknown }
  }
  readonly responses: {
    readonly [status: string | number]: {
      readonly description: string
      readonly content?: Content
      readonly headers?: unknown
      readonly [key: string]: unknown
    }
  }
  readonly components?: { readonly [name: string]: unknown }
  readonly middleware?: MiddlewareHandler | readonly MiddlewareHandler[]
  readonly hide?: boolean
  readonly [key: string]: unknown
}

/**
 * An Effect schema as a Standard Schema: typed by its encoded side on the way in (what is sent),
 * its type on the way out (what `c.req.valid()` gives).
 */
export type Standard<S> = S extends EffectSchema
  ? {
      readonly '~standard': {
        readonly version: 1
        readonly vendor: 'effect'
        readonly types?: { readonly input: S['Encoded']; readonly output: S['Type'] }
      }
    }
  : S

type ContentOf<C> = {
  readonly [M in keyof C]: { readonly [K in keyof C[M]]: K extends 'schema' ? Standard<C[M][K]> : C[M][K] }
}

type RequestOf<Q> = {
  readonly [K in keyof Q]: K extends 'body'
    ? { readonly [B in keyof Q[K]]: B extends 'content' ? ContentOf<Q[K][B]> : Q[K][B] }
    : Standard<Q[K]>
}

type ResponsesOf<Rs> = {
  readonly [S in keyof Rs]: {
    readonly [K in keyof Rs[S]]: K extends 'content'
      ? ContentOf<Rs[S][K]>
      : K extends 'headers'
        ? Standard<Rs[S][K]>
        : Rs[S][K]
  }
}

/** The route, its Effect schemas Standard Schemas: what the handlers and the clients are typed by. */
export type Converted<R> = {
  readonly [K in keyof R]: K extends 'request' ? RequestOf<R[K]> : K extends 'responses' ? ResponsesOf<R[K]> : R[K]
}

const converted = new WeakMap<object, unknown>()

/** An Effect schema as a Standard Schema with its JSON Schema; anything else as it is. */
function standard(value: unknown): unknown {
  if (!Schema.isSchema(value) || '~standard' in value) return value
  let result = converted.get(value)
  if (result === undefined) {
    // A route's schemas decode without services: the check runs inside Hono's handler, not an Effect.
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
    result = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(value as Schema.Codec<unknown, unknown>))
    converted.set(value, result)
  }
  return result
}

function convertContent(content: unknown): void {
  if (!isObject(content)) return
  for (const media of Object.values(content)) {
    if (isObject(media) && 'schema' in media) media.schema = standard(media.schema)
  }
}

function convertObject(value: unknown): void {
  if (!isObject(value) || Schema.isSchema(value)) return
  convertContent(value.content)
  // oxlint-disable-next-line no-param-reassign -- replaced in place, as said above
  if ('schema' in value) value.schema = standard(value.schema)
  if ('headers' in value) {
    const headers = value.headers
    // oxlint-disable-next-line no-param-reassign -- replaced in place, as said above
    if (Schema.isSchema(headers)) value.headers = standard(headers)
    else if (isObject(headers)) for (const header of Object.values(headers)) convertObject(header)
  }
}

/** `createRoute()`, its Effect schemas made Standard Schemas. */
export function createRoute<const R extends EffectRouteConfig>(route: R): Converted<R> {
  const request: unknown = route.request
  if (isObject(request)) {
    for (const part of ['params', 'query', 'headers', 'cookies']) {
      if (part in request) request[part] = standard(request[part])
    }
    convertObject(request.body)
  }
  for (const response of Object.values(route.responses)) convertObject(response)
  const components: unknown = route.components
  if (isObject(components)) {
    for (const [name, value] of Object.entries(components)) {
      if (Schema.isSchema(value)) components[name] = standard(value)
      else convertObject(value)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
  return createBase(route as never)
}
