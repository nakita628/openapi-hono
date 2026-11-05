import type { RuntimeRoute } from '../types/validation.js'
import { isObject } from './object.js'

const isRoute = (value: unknown): value is RuntimeRoute =>
  isObject(value) && typeof value.method === 'string' && typeof value.path === 'string'

/** The routes of `routes`: one route, an array of them, or a module of them. */
export const listRoutes = (routes: unknown): readonly RuntimeRoute[] =>
  isRoute(routes) ? [routes] : Object.values(isObject(routes) ? routes : {}).filter(isRoute)
