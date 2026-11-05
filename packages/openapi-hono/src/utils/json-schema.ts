import { isObject } from './object.js'

export type Json = { [keyword: string]: unknown }

export const SCHEMA_REF = '#/components/schemas/'

/** A `$ref` into a JSON Schema's own definitions. */
export const DEFS = /^#\/(?:\$defs|definitions)\//u

/** Zod's names for the recursive schemas it was not given one for. */
export const UNNAMED = /^__schema\d+$/u

const canonicals = new WeakMap<object, string>()

/** A value with object keys sorted, to compare JSON Schemas (kept per object: each is built once). */
export const canonical = (value: unknown): string => {
  if (!isObject(value)) return JSON.stringify(value)
  const known = canonicals.get(value)
  if (known !== undefined) return known
  const result = Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value)
        .toSorted()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(',')}}`
  canonicals.set(value, result)
  return result
}

/**
 * Whether two JSON values are the same, their object keys in any order: `canonical(a) ===
 * canonical(b)`, told without writing either out, and from the first difference.
 */
export const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!isObject(a) || !isObject(b)) return false
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]))
  if (Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
}

/**
 * A schema whose JSON Schema is told apart by its shape: an object, an array, a union. A named
 * `string` is not, or every string of the document would become a `$ref` to it.
 */
export const isCompound = (schema: Json): boolean =>
  schema.type === 'object' ||
  schema.type === 'array' ||
  ['properties', 'items', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'enum'].some((key) => key in schema)

/** A parameter's schema told apart by its shape: anything but a bare `{ type }`. */
export const isDistinct = (schema: Json): boolean => Object.keys(schema).some((key) => key !== 'type')

/**
 * A schema without `additionalProperties: false`, to compare two sides of one: Zod writes it on
 * the output side of every object (it strips the keys it does not know), which is no difference
 * worth a second component.
 */
export const unstrict = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(unstrict)
    : isObject(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key, item]) => !(key === 'additionalProperties' && item === false))
            .map(([key, item]) => [key, unstrict(item)]),
        )
      : value

export const renameRefs = (value: unknown, renames: ReadonlyMap<string, string>): unknown => {
  if (renames.size === 0) return value
  if (Array.isArray(value)) return value.map((item) => renameRefs(item, renames))
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key !== '$ref' || typeof item !== 'string' || !item.startsWith(SCHEMA_REF)) {
        return [key, renameRefs(item, renames)]
      }
      const to = renames.get(item.slice(SCHEMA_REF.length))
      return [key, to === undefined ? item : `${SCHEMA_REF}${to}`]
    }),
  )
}

export const refsIn = (value: unknown, found: Set<string>): Set<string> => {
  if (Array.isArray(value)) for (const item of value) refsIn(item, found)
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') found.add(item)
      else refsIn(item, found)
    }
  }
  return found
}
