/**
 * The schemas named in the document's components are its `definitions`, so that a `$ref` to one
 * (a recursive one, too) is written with that name.
 */

import { toStandardJsonSchema } from '@valibot/to-json-schema'
import type { ConversionConfig } from '@valibot/to-json-schema'
import type { GenericSchema } from 'valibot'

import { registerConverter } from '../../utils/converter.js'
import type { Json } from '../../utils/json-schema.js'

/**
 * `minCodePoints` / `maxCodePoints` are JSON Schema's `minLength` / `maxLength`, which count code
 * points; a pattern with flags has no JSON Schema, and is left out rather than written wrong.
 */
const DEFAULTS: ConversionConfig = {
  overrideAction: ({ valibotAction, jsonSchema }) => {
    const { type } = valibotAction
    const requirement: unknown = 'requirement' in valibotAction ? valibotAction.requirement : undefined
    if (type === 'min_code_points') return { ...jsonSchema, minLength: Number(requirement) }
    if (type === 'max_code_points') return { ...jsonSchema, maxLength: Number(requirement) }
    if (type === 'regex' && requirement instanceof RegExp && requirement.flags !== '') {
      const { pattern: _pattern, ...rest } = jsonSchema
      return rest
    }
    return undefined
  },
}

/** A Valibot schema: what is registered for the vendor `valibot` is handed only those. */
const isValibot = (value: object): value is GenericSchema => '~run' in value && '~standard' in value

registerConverter('valibot', (schema, io, { components, ...options }): Json => {
  if (!isValibot(schema)) return {}
  const definitions = Object.fromEntries([...components].filter((entry) => isValibot(entry[1])))
  return toStandardJsonSchema(schema)['~standard'].jsonSchema[io]({
    ...options,
    libraryOptions: { ...DEFAULTS, definitions, ...options.libraryOptions },
  })
})

export { createRoute } from '../route/index.js'
