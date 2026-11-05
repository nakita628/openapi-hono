# openapi-hono

OpenAPI routes for Hono: declare a route with `createRoute()`, register it with
`app.openapi(route, handler)`. The request is checked with the route's schemas, and the OpenAPI
document is generated from the same routes. Zod, Valibot, ArkType and Effect are supported.

## Install

```sh
npm i openapi-hono hono @hono/standard-validator @standard-schema/spec
```

## Usage

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

Each part of the request is checked by
[`@hono/standard-validator`](https://github.com/honojs/middleware/tree/main/packages/standard-validator)
before the handler runs: a part that does not match is answered with its 400.

```json
{ "data": { "selected": "Express" }, "error": [{ "message": "...", "path": ["selected"] }], "success": false }
```

## Client

Hono's client:

```ts
import { hc } from 'hono/client'

const client = hc<typeof app>('/')
await client.hono.$post({ json: { selected: 'HonoX' } })
```

Or by operationId, from the routes:

```ts
import { createClient } from 'openapi-hono/client'
import * as routes from './routes'

const client = createClient(routes, '/')
await client.postHono({ json: { selected: 'HonoX' } }) // { message: 'HonoX is selected' }
```

Each call answers what Hono's `parseResponse()` does, and throws what it throws for a response that
is not ok: Hono's `DetailedError`.

```ts
import { DetailedError } from 'openapi-hono/client'

try {
  await client.postHono({ json: { selected: 'Express' } })
} catch (error) {
  if (error instanceof DetailedError && error.statusCode === 400) {
    error.detail.data // { data, error, success: false }
  }
}
```

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/openapi-hono?tab=MIT-1-ov-file) for more information.
