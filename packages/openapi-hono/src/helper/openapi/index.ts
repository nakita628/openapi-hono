/**
 * Each schema is converted through Standard JSON Schema (`~standard.jsonSchema`), whichever
 * library made it, as its input: what goes on the wire, as the client is typed.
 *
 * Zod is handed the names (as its metadata registry): it writes the `$ref`s itself, by schema,
 * wherever a named schema is. Another library's named schema is a `$ref` where it is used as
 * is, and where its JSON Schema appears inside another if it is an object, an array or a union.
 */

import type { OpenAPIConfig, OpenAPIDocument } from '../../types/openapi.js'
import { renameRefs } from '../../utils/json-schema.js'
import { entriesOf, isObject } from '../../utils/object.js'
import { listRoutes } from '../../utils/route.js'
import { isSchema } from '../../utils/schema.js'
import { KINDS } from './components.js'
import { Generator } from './generator.js'
import { toOpenAPI30 } from './openapi30.js'

export { OpenAPIGenerationError } from './error.js'

/** The OpenAPI document (3.1 by default) of the routes (one, an array, or a module of them). */
export function generateDocument(routes: unknown, config: OpenAPIConfig): OpenAPIDocument {
  const {
    openapi = '3.1.0',
    info,
    webhooks,
    paths: pathFields = {},
    libraryOptions,
    responseSchemas,
    components: { schemas: named = {}, ...otherComponents } = {},
    ...rest
  } = config
  const generator = new Generator(
    libraryOptions,
    responseSchemas,
    openapi.startsWith('3.0.') ? 'openapi-3.0' : 'draft-2020-12',
  )
  const list = listRoutes(routes)
  for (const [name, schema] of Object.entries(named)) {
    // A JSON Schema as it is is a component of its own; a schema is named for its uses.
    if (isSchema(schema)) generator.give(name, schema, true)
    else generator.components.schemas.set(name, schema)
  }
  for (const route of list) {
    const declared = 'components' in route ? route.components : undefined
    for (const [name, value] of entriesOf(declared)) generator.give(name, value, false)
  }

  const paths: Record<string, Record<string, unknown>> = {}
  // Path-level fields first, the operations after them, as OpenAPI lists a Path Item.
  for (const [path, fields] of Object.entries(pathFields)) paths[path] = generator.pathFields(fields, `paths ${path}`)
  for (const route of list) {
    const where = `${route.method.toUpperCase()} ${route.path}`
    paths[route.path] = {
      ...paths[route.path],
      [route.method.toLowerCase()]: generator.operation(route, where),
    }
  }
  const writtenWebhooks =
    webhooks === undefined
      ? undefined
      : Object.fromEntries(
          entriesOf(webhooks).map(([name, item]) => [name, generator.pathItem(item, `webhook ${name}`)]),
        )

  const renames = generator.mergeOutputs()
  const rename = (record: Readonly<Record<string, unknown>>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, renameRefs(value, renames)]))
  const body: Pick<OpenAPIDocument, 'paths' | 'webhooks'> = {
    paths: Object.fromEntries(Object.entries(paths).map(([path, item]) => [path, rename(item)])),
    ...(writtenWebhooks === undefined ? {} : { webhooks: rename(writtenWebhooks) }),
  }
  generator.prune(body)
  const written: Record<string, unknown> = { ...otherComponents }
  for (const kind of KINDS) {
    const map = generator.components[kind]
    if (map.size > 0) written[kind] = { ...(isObject(written[kind]) ? written[kind] : {}), ...Object.fromEntries(map) }
  }
  // A kind given in `config.components` is written as it is, an object or not.
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
  const components = written as NonNullable<OpenAPIDocument['components']>
  const document: OpenAPIDocument = {
    openapi,
    info,
    ...rest,
    ...body,
    ...(Object.keys(written).length > 0 ? { components } : {}),
  }
  return openapi.startsWith('3.0.') ? toOpenAPI30(document, generator.components.pathItems) : document
}
