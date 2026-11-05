import type { Hook as StandardValidatorHook } from '@hono/standard-validator'
import type { Env } from 'hono'

/** A route, as it is read at run time. */
export type RuntimeRoute = {
  readonly method: string
  readonly path: string
  readonly request?: {
    readonly params?: unknown
    readonly query?: unknown
    readonly headers?: unknown
    readonly cookies?: unknown
    readonly body?: {
      readonly required?: boolean
      readonly content: { readonly [mediaType: string]: { readonly schema?: unknown } }
    }
  }
  readonly responses: {
    readonly [status: string]: {
      readonly $ref?: string
      readonly content?: { readonly [mediaType: string]: { readonly schema?: unknown } }
    }
  }
}

export type Target = 'param' | 'query' | 'header' | 'cookie' | 'form' | 'json'

/**
 * Called with each part's result, as `@hono/standard-validator`'s hook (it is that hook): a
 * `Response` it returns answers instead (of the 400, for a part that does not match).
 */
export type Hook = StandardValidatorHook<unknown, Env, string>
