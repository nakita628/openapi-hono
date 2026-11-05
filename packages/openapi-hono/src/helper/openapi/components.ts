import { isObject } from '../../utils/object.js'
import { isSchema } from '../../utils/schema.js'

/** The kinds of components, in the order the specification lists them. */
export const KINDS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
] as const

export type Kind = (typeof KINDS)[number]

/** The suffix dropped from a name for each kind (`UserSchema` is `User`); a security scheme keeps its name. */
export const SUFFIX: Readonly<Record<Kind, RegExp | undefined>> = {
  schemas: /Schema$/u,
  responses: /Response$/u,
  parameters: /(?:Param(?:eter)?|Schema)$/u,
  examples: /Example$/u,
  requestBodies: /(?:Request)?Body$/u,
  headers: /(?:Header|Schema)$/u,
  // `security: [{ BearerAuth: [] }]` names the scheme as it is.
  securitySchemes: undefined,
  links: /Link$/u,
  callbacks: /Callback$/u,
  pathItems: /PathItem$/u,
}

export const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

const SECURITY_TYPES = new Set(['apiKey', 'http', 'oauth2', 'openIdConnect', 'mutualTLS'])

export const isSecurityScheme = (value: unknown): boolean =>
  isObject(value) && !isSchema(value) && typeof value.type === 'string' && SECURITY_TYPES.has(value.type)

export const ref = (kind: Kind, name: string) => ({ $ref: `#/components/${kind}/${name}` })

/** The suffix of a schema written for the output side, while it may differ from the input side's. */
export const OUTPUT = 'Output'

export const LOCATIONS = [
  ['params', 'path'],
  ['query', 'query'],
  ['headers', 'header'],
  ['cookies', 'cookie'],
] as const
