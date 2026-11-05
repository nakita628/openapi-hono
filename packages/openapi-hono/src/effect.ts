/** openapi-hono/effect: `createRoute()` for Effect Schema, which takes Effect's schemas as they are. */

// oxlint-disable-next-line import/no-unassigned-import -- the import is the augmentation of HonoBase
import './augment.js'

export { createRoute } from './helper/effect/index.js'
export type { Converted, EffectRouteConfig, Standard } from './helper/effect/index.js'
