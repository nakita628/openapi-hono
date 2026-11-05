/** The config of `openapi-hono-gen`, checked by Effect Schema before anything is generated. */

import { posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Effect, FileSystem, Schema, SchemaIssue } from 'effect'
import type { FormatConfig } from 'oxfmt'

export const DEFAULT_CONFIG_FILE = 'openapi-hono-gen.config.ts'

/** The documents the input can be: OpenAPI as JSON or YAML, or TypeSpec. */
const INPUT = /\.(?:ya?ml|json|tsp)$/u

const SCHEMA_LIBRARIES = ['zod', 'valibot', 'arktype', 'effect'] as const

export type SchemaLibrary = (typeof SCHEMA_LIBRARIES)[number]

const ConfigSchema = Schema.Struct({
  input: Schema.String.check(Schema.isPattern(INPUT, { message: 'must be .yaml | .yml | .json | .tsp' })).annotate({
    title: 'Input document',
    description: 'The OpenAPI (.yaml, .yml, .json) or TypeSpec (.tsp) document to generate from.',
    examples: ['openapi.yaml', './spec/main.tsp'],
  }),
  output: Schema.String.check(Schema.isPattern(/\.ts$/u, { message: 'must be a .ts file' })).annotate({
    title: 'Routes file',
    description:
      'The file of the components and the routes (`createRoute()`). With `template`, the app entry (`index.ts`) and the handlers (`handlers/`) are written next to it.',
    examples: ['./src/routes.ts'],
  }),
  schema: Schema.Literals(SCHEMA_LIBRARIES)
    .pipe(Schema.withDecodingDefault(Effect.succeed('zod')))
    .annotate({
      title: 'Schema library',
      description:
        "The library the schemas are written with. `effect` declares the routes with `createRoute()` from 'openapi-hono/effect'; `valibot` with `createRoute()` from 'openapi-hono/valibot'.",
      examples: ['zod', 'valibot', 'arktype', 'effect'],
    }),
  template: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      "Also scaffold the app next to `output`: `handlers/<tag>.ts`, an empty handler for each route (`RouteHandler<typeof route> = async (c) => {}`), yours to write, and `index.ts`, the app that registers each (`new Hono().openapi(route, handler)`). The document is yours to serve: `app.doc('/doc', { info })`, each route naming its components. Generating again keeps the handlers you have written, and registers the document's routes.",
  }),
  split: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Divide the routes into groups by the first segment of their path (`/books` and `/books/{id}` as `books`, `/` as `index`): with `template`, the registrations of each group exported (`booksApi`); with `client`, a client per group (`booksClient`).',
  }),
  exportSchemas: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.schemas`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportSchemasTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Also export the type of each `components.schemas` entry (`export type`), whether or not the value is exported.',
  }),
  exportResponses: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.responses`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportParameters: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.parameters`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportParametersTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Also export the type of each `components.parameters` entry (`export type`), whether or not the value is exported.',
  }),
  exportExamples: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.examples`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportRequestBodies: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.requestBodies`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportHeaders: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.headers`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportHeadersTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Also export the type of each `components.headers` entry (`export type`), whether or not the value is exported.',
  }),
  exportSecuritySchemes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.securitySchemes`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportLinks: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.links`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportCallbacks: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.callbacks`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportPathItems: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.pathItems`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportMediaTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Export `components.mediaTypes`: each is written either way, and the routes refer to it; this adds `export`.',
  }),
  exportMediaTypesTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description:
      'Also export the type of each `components.mediaTypes` entry (`export type`), whether or not the value is exported.',
  }),
  pathAlias: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^[^\s'"`\\]+$/u, { message: 'must be an import prefix, with no whitespace or quotes' }),
    ).annotate({
      title: 'Path alias',
      description:
        "Import prefix the generated files use for one another instead of relative paths: `@/` where the tsconfig maps `@/*` to the directory of `output` (`import { getTodosRoute } from '@/routes.js'`). A file written outside that directory (a client in another package) imports relatively.",
      examples: ['@/', '~/'],
    }),
  ),
  format: Schema.optionalKey(
    Schema.declare<FormatConfig>(
      (value): value is FormatConfig => typeof value === 'object' && value !== null,
    ).annotate({
      title: 'Formatter options',
      description:
        "oxfmt's options the generated file is formatted with, over the defaults: printWidth 100, single quotes, no semicolons.",
      examples: [{ printWidth: 80, semi: true }],
    }),
  ),
  client: Schema.optionalKey(
    Schema.Struct({
      output: Schema.String.check(Schema.isPattern(/\.ts$/u, { message: 'must be a .ts file' })).annotate({
        title: 'Client file',
        examples: ['./src/client.ts'],
      }),
      baseUrl: Schema.optionalKey(
        Schema.String.annotate({
          description:
            "What the `hc` client is created with (`mode: 'hc'`): `hcWithType('/')`. `/` (the default) for same-origin requests.",
          examples: ['/', 'http://localhost:8787'],
        }),
      ),
      mode: Schema.Literals(['hc', 'operation']).annotate({
        description:
          "`hc`: Hono's client, `export const client = hcWithType(baseUrl)` with its type declared once (`type Client = ReturnType<typeof hc<typeof api>>`), called by path (`client.books[':id'].$get()`); needs `template`. `operation`: openapi-hono's `createClient(routes, baseUrl)`, called by operationId (`client.getBook()`) — a route without an operationId is given one from its method and path.",
        examples: ['hc', 'operation'],
      }),
    }).annotate({
      title: 'Client',
      description: 'The client of the routes, written to a file of its own.',
      examples: [{ output: './src/client.ts', mode: 'hc' }],
    }),
  ),
})
  .check(
    Schema.makeFilter((config) => config.client?.mode !== 'hc' || config.template, {
      message: "client.mode 'hc' is typed by the app, so it needs template: true",
    }),
  )
  .check(
    Schema.makeFilter((config) => !config.template || posix.basename(config.output) !== 'index.ts', {
      message: 'output: with template, the app entry is index.ts next to output, so output is another file',
    }),
  )
  .check(
    Schema.makeFilter(
      (config) =>
        config.client === undefined ||
        ![config.output, ...(config.template ? [posix.join(posix.dirname(config.output), 'index.ts')] : [])]
          .map((path) => posix.normalize(path))
          .includes(posix.normalize(config.client.output)),
      { message: 'client.output: the client is a file of its own' },
    ),
  )

/** The config, its defaults filled in. */
export type Config = typeof ConfigSchema.Type

/** The config as it is written: the options that have a default may be left out. */
export type ConfigInput = typeof ConfigSchema.Encoded

/** Types the config of `openapi-hono-gen.config.ts`. */
export function defineConfig(config: ConfigInput): ConfigInput {
  return config
}

// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError()` is the class factory, not a throw
export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

const decodeConfig = Schema.decodeUnknownEffect(ConfigSchema)
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1()

/** The config checked, or a `ConfigError` that names the field that is wrong. */
export function parseConfig(config: unknown) {
  return decodeConfig(config).pipe(
    Effect.mapError((error) => {
      const [issue] = formatIssue(error.issue).issues
      const path = (issue?.path ?? [])
        .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.')
      return new ConfigError({ message: `Invalid config: ${path === '' ? '' : `${path}: `}${issue?.message ?? ''}` })
    }),
  )
}

/** The default export of the config file, checked. */
export function readConfig(configPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const absolute = resolve(process.cwd(), configPath)
    const found = yield* fs.exists(absolute).pipe(Effect.catchTag('PlatformError', () => Effect.succeed(false)))
    if (!found) return yield* new ConfigError({ message: `Config not found: ${absolute}` })
    const mod: unknown = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(absolute).href),
      catch: (error) => new ConfigError({ message: error instanceof Error ? error.message : String(error) }),
    })
    if (typeof mod !== 'object' || mod === null || !('default' in mod)) {
      return yield* new ConfigError({ message: `Config must export default defineConfig({ ... }): ${absolute}` })
    }
    return yield* parseConfig(mod.default)
  })
}
