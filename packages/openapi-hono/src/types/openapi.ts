export type JsonSchema = { readonly [keyword: string]: unknown }

export type OpenAPIConfig = {
  /**
   * `3.1.0` by default. A `3.0.x` document has its schemas rewritten in OpenAPI 3.0's dialect
   * (`nullable`, `example`, ...); it has no webhooks, and its callbacks hold their Path Items.
   */
  readonly openapi?: '3.0.0' | '3.0.1' | '3.0.2' | '3.0.3' | '3.0.4' | '3.1.0' | '3.1.1' | '3.2.0'
  readonly info: { readonly title: string; readonly version: string; readonly [key: string]: unknown }
  /** Webhooks by name: a Path Item (its operations written as routes are), or a route. */
  readonly webhooks?: { readonly [name: string]: unknown }
  /**
   * Path-level fields by path template (`summary`, `description`, `servers`, and `parameters`
   * every operation of the path shares), written with the routes' operations.
   */
  readonly paths?: { readonly [path: string]: { readonly [field: string]: unknown } }
  /** Options handed to each library's JSON Schema conversion (Standard JSON Schema's `libraryOptions`). */
  readonly libraryOptions?: { readonly [option: string]: unknown }
  /**
   * Which side of a response's schemas to write: `input` (the default) or `output`. In `output`, a
   * named schema whose two sides differ is written twice: `User` and `UserOutput`.
   */
  readonly responseSchemas?: 'input' | 'output'
  readonly components?: {
    /** Schemas to name, by key: a schema of any library, or a JSON Schema as it is. */
    readonly schemas?: { readonly [name: string]: unknown }
    /** `securitySchemes`, `examples`, ...: written as they are. */
    readonly [key: string]: unknown
  }
  /** `servers`, `tags`, `security`, `externalDocs`, ...: written as they are. */
  readonly [key: string]: unknown
}

export type OpenAPIDocument = {
  readonly openapi: string
  readonly info: OpenAPIConfig['info']
  readonly paths: { readonly [path: string]: { readonly [method: string]: unknown } }
  readonly webhooks?: { readonly [name: string]: unknown }
  readonly components?: { readonly [kind: string]: { readonly [name: string]: unknown } }
  readonly [key: string]: unknown
}
