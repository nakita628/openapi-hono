/** openapi-hono: OpenAPI operations declared by `createRoute()` for Hono as it is. */

// oxlint-disable-next-line import/no-unassigned-import -- the import is the augmentation of HonoBase
import './augment.js'
export type { OperationSchema } from './augment.js'

export { getOpenAPIDocument, openAPIDocument } from './helper/hono/index.js'
export type { DocumentConfig, OpenAPIOptions } from './helper/hono/index.js'
export { generateDocument, OpenAPIGenerationError } from './helper/openapi/index.js'
export { createRoute, schema } from './helper/route/index.js'
export { withValidation } from './helper/validator/index.js'

export type {
  ClientInput,
  EndpointOf,
  HonoPath,
  InputOf,
  RouteHandler,
  RouteResponse,
  SchemaOf,
  StatusOf,
} from './types/handler.js'
export type { JsonSchema, OpenAPIConfig, OpenAPIDocument } from './types/openapi.js'
export type {
  InferInput,
  InferOutput,
  Method,
  RouteConfig,
  RouteContent,
  RouteSchema,
  StandardSchema,
  TypeSchema,
} from './types/route.js'
export type { Hook, RuntimeRoute, Target } from './types/validation.js'
