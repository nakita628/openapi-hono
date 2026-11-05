/**
 * The document is read off the app's own route table (`app.routes`), so an app mounted with
 * `app.route()` or made with `basePath()` is in the document of the app it is served by.
 */

import type { Context, Env, Hono, MiddlewareHandler } from 'hono'
import type { Handler } from 'hono/types'

import type { OpenAPIConfig, OpenAPIDocument } from '../../types/openapi.js'
import type { RouteConfig } from '../../types/route.js'
import type { Hook, RuntimeRoute } from '../../types/validation.js'
import { isObject } from '../../utils/object.js'
import { honoPathOf } from '../../utils/path.js'
import { generateDocument } from '../openapi/index.js'
import { describe } from '../openapi/operation.js'
import { withValidation } from '../validator/index.js'

export type OpenAPIOptions = {
  /** Called with the result of each part's check; a `Response` it returns answers instead (of the 400). */
  readonly hook?: Hook
  /**
   * Whether a JSON response is checked with the schema its route declares for its status (a 500
   * when it does not match), and answered as the schema's output. `true` by default.
   */
  readonly validateResponse?: boolean
}

type Extra = Pick<RouteConfig, 'middleware' | 'hide'>

/** The route of each handler `operationOf()` made, read back when the document is written. */
const routes = new WeakMap<object, RuntimeRoute & Extra>()

/** Where Hono keeps the handler of a mounted app that has its own `onError`. */
const COMPOSED_HANDLER = '__COMPOSED_HANDLER'

type Next = () => Promise<void>

type Handle = (c: Context<Env, string>, next: Next) => unknown

const isHandler = (value: unknown): value is (c: Context, next: Next) => unknown => typeof value === 'function'

/** The route's middleware around the handler, in order, as Hono runs a route's handlers. */
function around(middleware: readonly MiddlewareHandler[], handle: Handle): Handle {
  return async (c, next) => {
    const dispatch = async (i: number): Promise<void> => {
      const current = middleware[i]
      if (current === undefined) {
        const res = await handle(c, next)
        if (res instanceof Response) c.res = res
        return
      }
      const res = await current(c, () => dispatch(i + 1))
      if (res instanceof Response) c.res = res
    }
    await dispatch(0)
    return c.res
  }
}

export function operationOf(
  route: RouteConfig,
  handler: unknown,
  options: OpenAPIOptions = {},
): [method: string, path: string, handler: Handle] {
  if (!isHandler(handler)) {
    throw new TypeError(`The handler of ${route.method.toUpperCase()} ${route.path} is not a function`)
  }
  const runtime: RuntimeRoute & Extra = route
  const handle = withValidation(runtime, handler, options.hook, options.validateResponse ?? true)
  const middleware = runtime.middleware === undefined ? [] : [runtime.middleware].flat()
  const served = middleware.length === 0 ? handle : around(middleware, handle)
  routes.set(served, runtime)
  return [runtime.method.toUpperCase(), honoPathOf(runtime.path), served]
}

type App = Pick<Hono, 'routes'>

/** The operations the app serves, as the document describes them (`hide: true` leaves one out). */
function operationsOf(app: App): RuntimeRoute[] {
  return app.routes.flatMap(({ path, handler }) => {
    const inner = (COMPOSED_HANDLER in handler ? handler[COMPOSED_HANDLER] : undefined) ?? handler
    const route = isObject(inner) ? routes.get(inner) : undefined
    return route === undefined || route.hide === true ? [] : [describe(route, path)]
  })
}

/** The OpenAPI document (3.1 by default) of the operations the app serves. Throws `OpenAPIGenerationError`. */
export function getOpenAPIDocument(app: App, config: OpenAPIConfig): OpenAPIDocument {
  return generateDocument(operationsOf(app), config)
}

/** The document's config, or a function of the request's context (`servers` from its URL, say). */
export type DocumentConfig = OpenAPIConfig | ((c: Context) => OpenAPIConfig)

/**
 * A handler that answers the app's document as JSON. It is generated on the first request (on every
 * one when `config` is a function), so that it describes every operation registered by then.
 */
export function openAPIDocument(app: App, config: DocumentConfig): Handler {
  let cached: string | undefined = undefined
  return (c) => {
    if (typeof config === 'function') return c.json(getOpenAPIDocument(app, config(c)))
    cached ??= JSON.stringify(getOpenAPIDocument(app, config))
    return c.body(cached, 200, { 'Content-Type': 'application/json' })
  }
}
