/** The shape `@hono/zod-openapi` uses, so that a route declared here serves there as well. */

import type { MiddlewareHandler } from 'hono'

export type Method = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options' | 'trace'

/**
 * A Standard Schema (https://standardschema.dev), whichever library made it: Zod, Valibot,
 * ArkType, Effect Schema. Only the key is required: comparing `~standard` with any type would
 * instantiate a library's own, for every schema of every route.
 */
export type StandardSchema = { readonly '~standard': unknown }

/** A TypeScript type in place of a schema, made by `schema<T>()`: it types the part, and checks nothing. */
export type TypeSchema<T = unknown> = {
  readonly '~schema': true
  /** The type, as a phantom: never set at run time. */
  readonly type?: T
}

/** What a schema slot takes: a Standard Schema (typed, and checked), or a type (typed only). */
export type RouteSchema = StandardSchema | TypeSchema

export type RouteContent = {
  readonly [mediaType: string]: { readonly schema?: RouteSchema; readonly [key: string]: unknown }
}

/** An OpenAPI operation. `path` is a path template (`/users/{id}`). */
export type RouteConfig = {
  readonly method: Method
  readonly path: string
  readonly request?: {
    readonly params?: RouteSchema
    readonly query?: RouteSchema
    readonly headers?: RouteSchema
    readonly cookies?: RouteSchema
    readonly body?: { readonly required?: boolean; readonly content: RouteContent; readonly [key: string]: unknown }
  }
  readonly responses: {
    readonly [status: string | number]: {
      readonly description: string
      readonly content?: RouteContent
      readonly [key: string]: unknown
    }
  }
  /** Schemas, responses, ... to write as components, by shorthand: `components: { TodoSchema }`. */
  readonly components?: { readonly [name: string]: unknown }
  /** Run before the check of the route's parts, in order. */
  readonly middleware?: MiddlewareHandler | readonly MiddlewareHandler[]
  /** Leaves the operation out of the document. */
  readonly hide?: boolean
  readonly [key: string]: unknown
}

/**
 * What a schema accepts. Zod's `_zod.input` is read first (one property lookup, not
 * `z.input<S>`), then any Standard Schema's `~standard.types.input`, then `schema<T>()`'s type.
 */
export type InferInput<S> = S extends { readonly _zod: { readonly input: unknown } }
  ? S['_zod']['input']
  : S extends { readonly '~standard': { readonly types?: { readonly input: infer I } | undefined } }
    ? I
    : S extends { readonly '~schema': true; readonly type?: infer T }
      ? T
      : unknown

/** What a schema produces: what the handler reads from `c.req.valid()`, its `transform`s applied. */
export type InferOutput<S> = S extends { readonly _zod: { readonly output: unknown } }
  ? S['_zod']['output']
  : S extends { readonly '~standard': { readonly types?: { readonly output: infer O } | undefined } }
    ? O
    : S extends { readonly '~schema': true; readonly type?: infer T }
      ? T
      : unknown
