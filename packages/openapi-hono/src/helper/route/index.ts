import type { RouteConfig, TypeSchema } from '../../types/route.js'

/** Declares an OpenAPI operation. An identity function: what matters is the literal type it keeps. */
export function createRoute<const R extends RouteConfig>(route: R): R {
  // `components` is for the document alone: kept off the route's enumerable fields, so that a
  // generator that writes a route's other fields into its operation leaves it out.
  if (Object.hasOwn(route, 'components') && Object.isExtensible(route)) {
    Object.defineProperty(route, 'components', { value: route.components, enumerable: false, writable: true })
  }
  return route
}

// Its phantom `type` is never set, so the one object is the TypeSchema of every T.
const TYPE_SCHEMA = Object.freeze({ '~schema': true })

/** A TypeScript type in place of a schema: `schema<Todo>()`. The part is typed by it, and not checked. */
export function schema<T>(): TypeSchema<T> {
  return TYPE_SCHEMA
}
