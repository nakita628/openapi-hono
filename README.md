# openapi-hono

OpenAPI routes for [Hono](https://hono.dev).

| Package                                         | Description                                                    |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [openapi-hono](./packages/openapi-hono)         | `createRoute()` and `app.openapi(route, handler)` for Hono      |
| [openapi-hono-gen](./packages/openapi-hono-gen) | Generates the routes, handlers, app and client from OpenAPI    |

## Install

```sh
npm i openapi-hono hono @hono/standard-validator @standard-schema/spec
```

## Examples

Each example is type-checked and run by the tests as it is written here.

### Zod

```ts
import * as z from 'zod'
import { Hono } from 'hono'
import { createRoute } from 'openapi-hono'
import type { RouteHandler } from 'openapi-hono'

const HonoSchema = z.enum(['Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono'])

export const postHonoRoute = createRoute({
  method: 'post',
  path: '/hono',
  operationId: 'postHono',
  request: {
    body: { content: { 'application/json': { schema: z.object({ selected: HonoSchema }) } } },
  },
  responses: {
    200: {
      description: 'The framework selected',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
  },
  components: { HonoSchema },
})

export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = (c) => {
  const data = c.req.valid('json')
  const { selected } = data
  return c.json({ message: `${selected} is selected` }, 200)
}

export const app = new Hono()
  .openapi(postHonoRoute, postHonoRouteHandler)
  .doc('/doc', { info: { title: 'Hono', version: '1.0.0' } })
```

### Valibot

```ts
import * as v from 'valibot'
import { Hono } from 'hono'
import { createRoute } from 'openapi-hono/valibot'
import type { RouteHandler } from 'openapi-hono'

const HonoSchema = v.picklist(['Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono'])

export const postHonoRoute = createRoute({
  method: 'post',
  path: '/hono',
  operationId: 'postHono',
  request: {
    body: { content: { 'application/json': { schema: v.object({ selected: HonoSchema }) } } },
  },
  responses: {
    200: {
      description: 'The framework selected',
      content: { 'application/json': { schema: v.object({ message: v.string() }) } },
    },
  },
  components: { HonoSchema },
})

export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = (c) => {
  const data = c.req.valid('json')
  const { selected } = data
  return c.json({ message: `${selected} is selected` }, 200)
}

export const app = new Hono()
  .openapi(postHonoRoute, postHonoRouteHandler)
  .doc('/doc', { info: { title: 'Hono', version: '1.0.0' } })
```

### ArkType

```ts
import { type } from 'arktype'
import { Hono } from 'hono'
import { createRoute } from 'openapi-hono'
import type { RouteHandler } from 'openapi-hono'

const HonoSchema = type.enumerated('Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono')

export const postHonoRoute = createRoute({
  method: 'post',
  path: '/hono',
  operationId: 'postHono',
  request: {
    body: { content: { 'application/json': { schema: type({ selected: HonoSchema }) } } },
  },
  responses: {
    200: {
      description: 'The framework selected',
      content: { 'application/json': { schema: type({ message: 'string' }) } },
    },
  },
  components: { HonoSchema },
})

export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = (c) => {
  const data = c.req.valid('json')
  const { selected } = data
  return c.json({ message: `${selected} is selected` }, 200)
}

export const app = new Hono()
  .openapi(postHonoRoute, postHonoRouteHandler)
  .doc('/doc', { info: { title: 'Hono', version: '1.0.0' } })
```

### Effect

```ts
import { Schema } from 'effect'
import { Hono } from 'hono'
import { createRoute } from 'openapi-hono/effect'
import type { RouteHandler } from 'openapi-hono'

const HonoSchema = Schema.Literals(['Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono'])

export const postHonoRoute = createRoute({
  method: 'post',
  path: '/hono',
  operationId: 'postHono',
  request: {
    body: { content: { 'application/json': { schema: Schema.Struct({ selected: HonoSchema }) } } },
  },
  responses: {
    200: {
      description: 'The framework selected',
      content: { 'application/json': { schema: Schema.Struct({ message: Schema.String }) } },
    },
  },
  components: { HonoSchema },
})

export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = (c) => {
  const data = c.req.valid('json')
  const { selected } = data
  return c.json({ message: `${selected} is selected` }, 200)
}

export const app = new Hono()
  .openapi(postHonoRoute, postHonoRouteHandler)
  .doc('/doc', { info: { title: 'Hono', version: '1.0.0' } })
```

Valibot also needs `@valibot/to-json-schema`, Effect `effect`.

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/openapi-hono?tab=MIT-1-ov-file) for more information.
