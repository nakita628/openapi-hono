import type { RouteConfig } from '../../types/route.js'
import type { RuntimeRoute } from '../../types/validation.js'
import { templateOf } from '../../utils/path.js'

type Extra = Pick<RouteConfig, 'middleware' | 'hide'>

/** The operation as the document describes it: at the path it is served at, with nothing else. */
export function describe(route: RuntimeRoute & Extra, path: string): RuntimeRoute {
  const { middleware: _middleware, hide: _hide, ...fields } = route
  const described: RuntimeRoute = {
    ...fields,
    path: templateOf(path),
  }
  // `components` is not enumerable (createRoute keeps it off the operation's fields).
  const components = 'components' in route ? route.components : undefined
  if (components !== undefined) Object.defineProperty(described, 'components', { value: components })
  return described
}
