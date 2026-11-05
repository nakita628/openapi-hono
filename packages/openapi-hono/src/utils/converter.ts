/** Conversions for libraries without Standard JSON Schema, by vendor. The package itself imports no library. */

import type { Json } from './json-schema.js'

/** What the generator asks a conversion for, as Standard JSON Schema's `input()` / `output()` are asked. */
type ConvertOptions = {
  readonly target: string
  readonly libraryOptions?: { readonly [option: string]: unknown }
  /** The schemas named in the document's components, by their name: what a `$ref` is written with. */
  readonly components: ReadonlyMap<string, object>
}

type Convert = (schema: object, io: 'input' | 'output', options: ConvertOptions) => Json

const converters = new Map<string, Convert>()

export function registerConverter(vendor: string, convert: Convert): void {
  converters.set(vendor, convert)
}

export const converterOf = (vendor: unknown): Convert | undefined =>
  typeof vendor === 'string' ? converters.get(vendor) : undefined
