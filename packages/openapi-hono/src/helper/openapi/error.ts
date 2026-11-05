/** A route that cannot be written: a schema without JSON Schema, an unnamed recursive one, a name twice. */
export class OpenAPIGenerationError extends Error {
  override readonly name = 'OpenAPIGenerationError'
}
