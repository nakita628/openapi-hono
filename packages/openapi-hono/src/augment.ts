/** Adds `openapi()`, `doc()` and `getOpenAPIDocument()` to Hono's `HonoBase`, for its types and at run time. */

import type { BlankSchema, Env, MergePath, Schema } from 'hono/types'
import { HonoBase } from 'hono/hono-base'

import { getOpenAPIDocument, openAPIDocument, operationOf } from './helper/hono/index.js'
import type { DocumentConfig, OpenAPIOptions } from './helper/hono/index.js'
import type { EndpointOf, HonoPath, RouteHandler } from './types/handler.js'
import type { OpenAPIConfig, OpenAPIDocument } from './types/openapi.js'
import type { RouteConfig } from './types/route.js'

/** The operation in Hono's schema: its path (with the app's base path), its method, its responses. */
export type OperationSchema<R extends RouteConfig, BasePath extends string> = {
  [P in MergePath<BasePath, HonoPath<R['path']>>]: { [M in R['method'] as `$${M}`]: EndpointOf<R> }
}

declare module 'hono/hono-base' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- only an interface merges into Hono's HonoBase class
  interface HonoBase<
    E extends Env = Env,
    S extends Schema = BlankSchema,
    BasePath extends string = '/',
    CurrentPath extends string = BasePath,
  > {
    /**
     * Serves the operation: its `middleware`, the check of its parts (400), the handler, the check
     * of its JSON response (500).
     */
    openapi: <R extends RouteConfig>(
      route: R,
      handler: RouteHandler<R, E>,
      options?: OpenAPIOptions,
    ) => HonoBase<E, S & OperationSchema<R, BasePath>, BasePath, CurrentPath>
    /** Serves the document of the app's operations as JSON at `GET path`. */
    doc: (path: string, config: DocumentConfig) => this
    /** The OpenAPI document (3.1 by default) of the app's operations. Throws `OpenAPIGenerationError`. */
    getOpenAPIDocument: (config: OpenAPIConfig) => OpenAPIDocument
  }
}

type Base = {
  on: (method: string, path: string, ...handlers: unknown[]) => unknown
  get: (path: string, handler: unknown) => unknown
  routes: HonoBase['routes']
}

Object.assign(HonoBase.prototype, {
  openapi(this: Base, route: RouteConfig, handler: unknown, options?: OpenAPIOptions) {
    this.on(...operationOf(route, handler, options))
    return this
  },
  doc(this: Base, path: string, config: DocumentConfig) {
    this.get(path, openAPIDocument(this, config))
    return this
  },
  getOpenAPIDocument(this: Base, config: OpenAPIConfig) {
    return getOpenAPIDocument(this, config)
  },
})
