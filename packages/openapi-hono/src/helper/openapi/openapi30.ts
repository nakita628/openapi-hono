import type { OpenAPIDocument } from '../../types/openapi.js'
import { canonical } from '../../utils/json-schema.js'
import type { Json } from '../../utils/json-schema.js'
import { isObject } from '../../utils/object.js'
import { OpenAPIGenerationError } from './error.js'

const NOT_IN_30 = new Set([
  '$schema',
  '$id',
  '$anchor',
  '$comment',
  '$defs',
  'definitions',
  '$dynamicRef',
  '$dynamicAnchor',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'patternProperties',
  'contains',
  'minContains',
  'maxContains',
  'contentMediaType',
  'contentEncoding',
  'contentSchema',
])

const isNullOnly = (schema: unknown): boolean => canonical(schema) === '{"nullable":true}'

/** A JSON Schema (2020-12) as OpenAPI 3.0's Schema Object writes it. */
function schema30(schema: unknown): unknown {
  if (!isObject(schema) || Array.isArray(schema)) return schema
  let out: Json = {}
  for (const [key, value] of Object.entries(schema)) {
    if (NOT_IN_30.has(key)) continue
    if (key === 'properties' && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, schema30(item)]))
    } else if (['items', 'not'].includes(key) || (key === 'additionalProperties' && isObject(value))) {
      out[key] = schema30(value)
    } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      out[key] = value.map(schema30)
    } else {
      out[key] = value
    }
  }
  // `type: ['string', 'null']`: one type and `nullable`; several, an `anyOf` of them.
  const declared: unknown = out.type
  const types: readonly unknown[] = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared]
  if (types.includes('null')) {
    const others = types.filter((type) => type !== 'null')
    delete out.type
    if (others.length === 1) out.type = others[0]
    else if (others.length > 1) out.anyOf = others.map((type) => ({ type }))
    out.nullable = true
  } else if (types.length > 1) {
    delete out.type
    out.anyOf = types.map((type) => ({ type }))
  }
  // A `{ type: 'null' }` member of a union: the union `nullable`, a lone member taking its place.
  for (const union of ['anyOf', 'oneOf'] as const) {
    const members: unknown = out[union]
    if (!Array.isArray(members) || !members.some(isNullOnly)) continue
    const others: readonly unknown[] = members.filter((member) => !isNullOnly(member))
    const { [union]: _members, ...rest } = out
    out = rest
    const [only] = others
    if (others.length === 1 && isObject(only) && '$ref' in only) out.allOf = others
    else if (others.length === 1) Object.assign(out, isObject(only) ? only : {})
    else out[union] = others
    out.nullable = true
  }
  if ('const' in out) {
    out.enum = [out.const]
    delete out.const
  }
  if (Array.isArray(out.examples)) {
    if (out.example === undefined && out.examples.length > 0) out.example = out.examples[0]
    delete out.examples
  }
  for (const [exclusive, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof out[exclusive] === 'number') {
      out[bound] = out[exclusive]
      out[exclusive] = true
    }
  }
  // A tuple: its items' union (3.0 has no `prefixItems`).
  const prefix: unknown = out.prefixItems
  if (Array.isArray(prefix)) {
    if (out.items === undefined || out.items === false) {
      out.items = prefix.length === 1 ? prefix[0] : { anyOf: prefix }
    }
    delete out.prefixItems
  }
  // 3.0 reads nothing beside a `$ref`: the keywords next to it are kept through `allOf`.
  if (typeof out.$ref === 'string' && Object.keys(out).length > 1) {
    const { $ref, ...rest } = out
    out = { allOf: [{ $ref }], ...rest }
  }
  return out
}

function document30(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(document30)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'schema' ? schema30(item) : key === 'example' || key === 'examples' ? item : document30(item),
    ]),
  )
}

/** A Path Item `$ref` replaced by the Path Item: 3.0 has no `components.pathItems`. */
function inlinePathItems(value: unknown, pathItems: ReadonlyMap<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => inlinePathItems(item, pathItems))
  if (!isObject(value)) return value
  const target = typeof value.$ref === 'string' ? value.$ref : undefined
  if (target?.startsWith('#/components/pathItems/')) {
    return inlinePathItems(pathItems.get(target.slice('#/components/pathItems/'.length)), pathItems)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inlinePathItems(item, pathItems)]))
}

export function toOpenAPI30(document: OpenAPIDocument, pathItems: ReadonlyMap<string, unknown>): OpenAPIDocument {
  if (document.webhooks !== undefined) {
    throw new OpenAPIGenerationError(`OpenAPI ${document.openapi} has no webhooks: write a 3.1 document for them`)
  }
  const { pathItems: _pathItems, schemas, ...components } = document.components ?? {}
  // Both rewrites keep the document's shape: a Path Item `$ref` becomes the Path Item, a schema its 3.0 form.
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
  const written = document30(inlinePathItems({ ...document, components }, pathItems)) as OpenAPIDocument
  const allComponents = {
    ...written.components,
    ...(schemas === undefined
      ? {}
      : { schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, schema30(schema)])) }),
  }
  const { components: _components, ...rest } = written
  return { ...rest, ...(Object.keys(allComponents).length > 0 ? { components: allComponents } : {}) }
}
