# openapi-hono-gen

Generates [openapi-hono](../openapi-hono) routes, handlers, the app and its client from an OpenAPI or
TypeSpec document.

## Install

```sh
npm i -D openapi-hono-gen
npm i openapi-hono hono @hono/standard-validator @standard-schema/spec zod
```

## Usage

```ts
// openapi-hono-gen.config.ts
import { defineConfig } from 'openapi-hono-gen'

export default defineConfig({
  input: 'openapi.yaml',
  output: './src/routes.ts',
  schema: 'zod',
  template: true,
  client: { output: './src/client.ts', mode: 'hc' },
})
```

```sh
npx openapi-hono-gen
```

## Example

```yaml
# openapi.yaml
openapi: 3.1.0
info:
  title: Hono
  version: 1.0.0
paths:
  /hono:
    post:
      operationId: postHono
      tags: [hono]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                selected:
                  $ref: '#/components/schemas/Hono'
              required: [selected]
      responses:
        '200':
          description: The framework selected
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
                required: [message]
components:
  schemas:
    Hono:
      type: string
      enum: [Hono, HonoX, Hono Zod OpenAPI, Hono OpenAPI, OpenAPI Hono]
```

### src/routes.ts

```ts
import { createRoute } from 'openapi-hono'
import * as z from 'zod'

const HonoSchema = z.enum(['Hono', 'HonoX', 'Hono Zod OpenAPI', 'Hono OpenAPI', 'OpenAPI Hono'])

export const postHonoRoute = createRoute({
  method: 'post',
  path: '/hono',
  operationId: 'postHono',
  tags: ['hono'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: z.object({ selected: HonoSchema }) },
      },
    },
  },
  responses: {
    200: {
      description: 'The framework selected',
      content: {
        'application/json': { schema: z.object({ message: z.string() }) },
      },
    },
  },
  components: { HonoSchema },
})
```

### src/handlers/hono.ts

```ts
import type { RouteHandler } from 'openapi-hono'
import type { postHonoRoute } from '../routes.js'

export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = async (c) => {}
```

The handler is generated empty, yours to write:

```ts
export const postHonoRouteHandler: RouteHandler<typeof postHonoRoute> = (c) => {
  const data = c.req.valid('json')
  const { selected } = data
  return c.json({ message: `${selected} is selected` }, 200)
}
```

### src/index.ts

```ts
import { Hono } from 'hono'
import { postHonoRouteHandler } from './handlers/index.js'
import { postHonoRoute } from './routes.js'

const app = new Hono()

export const api = app.openapi(postHonoRoute, postHonoRouteHandler)

export default app
```

### src/client.ts

```ts
import { hc } from 'hono/client'
import type { api } from './index.js'

type Client = ReturnType<typeof hc<typeof api>>

const hcWithType = (...args: Parameters<typeof hc>): Client => hc<typeof api>(...args)

export const client = hcWithType('/')
```

To serve the document, add `app.doc('/doc', { info: { title: 'Hono', version: '1.0.0' } })` with your own config: each route names the components it uses, so the document refers to them by `$ref`.

Run it again after editing the document: the handlers you have written are kept, new routes get an
empty handler and are registered on the app.

## Full Config

```ts
import { defineConfig } from 'openapi-hono-gen'

export default defineConfig({
  input: 'openapi.yaml', // .yaml, .yml, .json or .tsp

  output: './src/routes.ts', // the components and the routes
  schema: 'zod', // 'zod' | 'valibot' | 'arktype' | 'effect'
  // Import prefix the generated files use for one another, `@/routes.js` instead of
  // `./routes.js`. Map it in tsconfig (`"@/*": ["./src/*"]`).
  pathAlias: '@/',
  // format: {}, // oxfmt FormatConfig

  template: true, // index.ts and handlers/ next to output
  split: false, // true: the routes (`todosApi`) and a client for each first path segment

  client: {
    output: './src/client.ts',
    mode: 'hc', // 'hc' | 'operation'
    baseUrl: '/',
  },

  exportSchemas: true,
  exportSchemasTypes: true,
  exportResponses: true,
  exportParameters: true,
  exportParametersTypes: true,
  exportExamples: true,
  exportRequestBodies: true,
  exportHeaders: true,
  exportHeadersTypes: true,
  exportSecuritySchemes: true,
  exportLinks: true,
  exportCallbacks: true,
  exportPathItems: true,
  exportMediaTypes: true,
  exportMediaTypesTypes: true,
})
```

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/openapi-hono?tab=MIT-1-ov-file) for more information.
