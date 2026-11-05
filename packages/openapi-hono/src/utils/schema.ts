import { isObject } from './object.js'

/** A schema slot's value: a Standard Schema, or `schema<T>()`'s type. */
export const isSchema = (value: unknown): boolean => isObject(value) && ('~standard' in value || '~schema' in value)

/** A Standard Schema, a callable one included: one that checks. */
export const isStandard = (value: unknown): boolean => isObject(value) && '~standard' in value

export const isZod = (schema: unknown): boolean => {
  const standard = isObject(schema) ? schema['~standard'] : undefined
  return isObject(standard) && standard.vendor === 'zod'
}

export type StandardIssue = {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

type StandardResult = { readonly value?: unknown; readonly issues?: readonly StandardIssue[] }

export type Validate = (value: unknown) => StandardResult | Promise<StandardResult>

const isValidate = (value: unknown): value is Validate => typeof value === 'function'

/** A Standard Schema's `validate`; nothing for a schema that cannot check (`schema<T>()`). */
export function validatorOf(schema: unknown): Validate | undefined {
  const standard = isObject(schema) ? schema['~standard'] : undefined
  return isObject(standard) && isValidate(standard.validate) ? standard.validate : undefined
}
