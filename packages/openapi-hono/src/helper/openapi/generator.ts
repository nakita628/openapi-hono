import { converterOf } from '../../utils/converter.js'
import { isObject, entriesOf } from '../../utils/object.js'
import { isSchema, isZod } from '../../utils/schema.js'
import {
  canonical,
  DEFS,
  isCompound,
  isDistinct,
  refsIn,
  renameRefs,
  sameJson,
  SCHEMA_REF,
  UNNAMED,
  unstrict,
} from '../../utils/json-schema.js'
import type { Json } from '../../utils/json-schema.js'
import { isSecurityScheme, KINDS, LOCATIONS, METHODS, OUTPUT, ref, SUFFIX } from './components.js'
import type { Kind } from './components.js'
import { OpenAPIGenerationError } from './error.js'

const unnamedRecursion = (where: string) =>
  new OpenAPIGenerationError(
    `${where}: a recursive schema has no name. Name it in the route's components (components: { CategorySchema }).`,
  )

export type Target = 'draft-2020-12' | 'openapi-3.0'

type JsonSchemaOptions = {
  readonly target: Target
  readonly libraryOptions?: { readonly [option: string]: unknown }
}

type ZodMetadata = { readonly get: (schema: unknown) => Json | undefined }

/** Where Zod keeps its global registry, the metadata `.meta()` gives. */
const ZOD_GLOBAL_REGISTRY = '__zod_globalRegistry'

const isZodMetadata = (value: unknown): value is ZodMetadata => isObject(value) && typeof value.get === 'function'

type GenerateJsonSchema = (options: JsonSchemaOptions) => Json

const isGenerateJsonSchema = (value: unknown): value is GenerateJsonSchema => typeof value === 'function'

const componentMaps = (): Record<Kind, Map<string, unknown>> => ({
  schemas: new Map(),
  responses: new Map(),
  parameters: new Map(),
  examples: new Map(),
  requestBodies: new Map(),
  headers: new Map(),
  securitySchemes: new Map(),
  links: new Map(),
  callbacks: new Map(),
  pathItems: new Map(),
})

type Request = {
  readonly params?: unknown
  readonly query?: unknown
  readonly headers?: unknown
  readonly cookies?: unknown
  readonly body?: unknown
}

/** An operation, as a route declares it (a callback's or a webhook's may have no method or path). */
type OperationLike = {
  readonly method?: string
  readonly path?: string
  readonly request?: Request
  readonly responses?: unknown
  readonly callbacks?: unknown
  readonly [key: string]: unknown
}

export class Generator {
  readonly components = componentMaps()
  private readonly given = new Map<object, { readonly name: string; readonly exact: boolean }>()
  /** Which object took each component name, to tell `UserSchema` and `User` apart. */
  private readonly owners = new Map<string, { readonly value: object; readonly original: string }>()
  /** The named schemas by their schema name: a Zod `$ref` to one is told back to its schema. */
  private readonly byName = new Map<string, object>()
  /** The names given in `components` (not by a library): written only if referred to. */
  readonly givenSchemas = new Set<string>()
  /** Another library's named schemas: their JSON Schema, and their shapes to find them nested. */
  private readonly declared = new Map<string, Json>()
  private readonly shapes = new Map<string, string | null>()
  private readonly parameterShapes = new Map<string, string | null>()
  /** A schema converted for its properties alone (a parameter object): not written as a component. */
  private unnamed: unknown = undefined
  private readonly operationIds = new Map<string, string>()
  /** The side of the schemas being written: `output` within a response, when the config says so. */
  private io: 'input' | 'output' = 'input'

  constructor(
    private readonly libraryOptions: { readonly [option: string]: unknown } = {},
    private readonly responseSchemas: 'input' | 'output' = 'input',
    private readonly target: Target = 'draft-2020-12',
  ) {}

  /** The suffix of a schema's name on the output side: written apart, merged back when equal. */
  private get side(): string {
    return this.io === 'output' ? OUTPUT : ''
  }

  /** Zod's metadata, with the names given here as `id`s: what Zod writes its `$defs` from. */
  private readonly zodMetadata: ZodMetadata = {
    get: (schema) => {
      const global: unknown = Reflect.get(globalThis, ZOD_GLOBAL_REGISTRY)
      const metadata = isZodMetadata(global) ? global.get(schema) : undefined
      const name = schema === this.unnamed ? undefined : this.nameOf(schema, 'schemas')
      const id = name ?? (typeof metadata?.id === 'string' ? metadata.id : undefined)
      return id === undefined ? metadata : { ...metadata, id: `${id}${this.side}` }
    },
  }

  /** Gives `value` a name: `exact` as it is (a config key), or with its kind's suffix dropped. */
  give(name: string, value: unknown, exact: boolean): void {
    if (!isObject(value)) return
    const existing = this.given.get(value)
    if (existing !== undefined && existing.name !== name) {
      throw new OpenAPIGenerationError(`One component is named both "${existing.name}" and "${name}"`)
    }
    this.given.set(value, { name, exact })
    // A security scheme is not used in a route, only named in `security`: it is written as it is.
    if (isSecurityScheme(value)) this.components.securitySchemes.set(name, value)
    if (!isSchema(value)) return
    const base = this.nameOf(value, 'schemas') ?? name
    for (const io of this.responseSchemas === 'output' ? (['input', 'output'] as const) : (['input'] as const)) {
      this.io = io
      const schemaName = `${base}${this.side}`
      this.byName.set(schemaName, value)
      this.givenSchemas.add(schemaName)
      // Zod's are named by Zod, from the metadata; the others are found by their JSON Schema.
      if (isZod(value)) continue
      const json = this.jsonSchemaOf(value, `components.${name}`, schemaName)
      this.declared.set(schemaName, json)
      const mark = (shapes: Map<string, string | null>) => {
        const key = `${io} ${canonical(json)}`
        // A shape two names share names neither: it is only referred to where it is used as is.
        shapes.set(key, shapes.has(key) && shapes.get(key) !== schemaName ? null : schemaName)
      }
      if (isCompound(json)) mark(this.shapes)
      if (isDistinct(json)) mark(this.parameterShapes)
    }
    this.io = 'input'
  }

  private nameOf(value: unknown, kind: Kind): string | undefined {
    if (!isObject(value)) return undefined
    const given = this.given.get(value)
    if (given === undefined) return undefined
    const suffix = given.exact ? undefined : SUFFIX[kind]
    // A name that is the suffix alone (`Schema`) is kept as it is.
    const stripped = suffix === undefined ? '' : given.name.replace(suffix, '')
    const name = stripped === '' ? given.name : stripped
    const key = `${kind} ${name}`
    const owner = this.owners.get(key)
    if (owner !== undefined && owner.value !== value) {
      throw new OpenAPIGenerationError(
        owner.original === given.name
          ? `Two different ${kind} are named "${given.name}"`
          : `"${owner.original}" and "${given.name}" are both named "${name}" in components.${kind}: rename one`,
      )
    }
    this.owners.set(key, { value, original: given.name })
    return name
  }

  private add(kind: Kind, name: string, value: unknown): void {
    const map = this.components[kind]
    const existing = map.get(name)
    if (existing !== undefined && !sameJson(existing, value)) {
      throw new OpenAPIGenerationError(`Two different ${kind} are named "${name}"`)
    }
    map.set(name, value)
  }

  /** `value` as a `kind`: written as a component and referred to if it was named, as is otherwise. */
  private named(kind: Kind, value: unknown, write: () => unknown): unknown {
    const name = this.nameOf(value, kind)
    if (name === undefined) return write()
    if (!this.components[kind].has(name)) {
      this.components[kind].set(name, {}) // in place first: a component that refers to itself ends here
      this.components[kind].set(name, write())
    }
    return ref(kind, name)
  }

  /** `#/$defs/X` as `#/components/schemas/X`, and `#` (the schema itself) as the component `self`. */
  private rewriteRefs(value: unknown, where: string, self: string | undefined, defsSide = ''): unknown {
    if (Array.isArray(value)) return value.map((item) => this.rewriteRefs(item, where, self, defsSide))
    if (!isObject(value)) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key !== '$ref' || typeof item !== 'string') return [key, this.rewriteRefs(item, where, self, defsSide)]
        if (item !== '#') return [key, DEFS.test(item) ? `${item.replace(DEFS, SCHEMA_REF)}${defsSide}` : item]
        if (self === undefined) throw unnamedRecursion(where)
        return [key, `${SCHEMA_REF}${self}`]
      }),
    )
  }

  /**
   * The JSON Schema of a schema that has none of its own, by the conversion registered for its
   * library (Valibot's, by `openapi-hono/valibot`), given the schemas named in the components.
   */
  private converted(schema: unknown, standard: unknown): GenerateJsonSchema | undefined {
    const vendor = isObject(standard) ? standard.vendor : undefined
    const convert = converterOf(vendor)
    if (convert === undefined || !isObject(schema)) return undefined
    const io = this.io
    // The named schemas of the same library: another library's are not this conversion's to write.
    const components = new Map<string, object>()
    for (const value of this.given.keys()) {
      const own = isObject(value) ? value['~standard'] : undefined
      const name = isObject(own) && own.vendor === vendor ? this.nameOf(value, 'schemas') : undefined
      if (name !== undefined) components.set(`${name}${this.side}`, value)
    }
    return (options) => convert(schema, io, { ...options, components })
  }

  /** The JSON Schema of a schema's input, its `$defs` moved to the components. */
  private jsonSchemaOf(schema: unknown, where: string, self?: string): Json {
    if (isObject(schema) && schema['~schema'] === true) return {} // `schema<T>()`: a type, no JSON Schema
    const standard = isObject(schema) ? schema['~standard'] : undefined
    const jsonSchema = isObject(standard) ? standard.jsonSchema : undefined
    const generate = isObject(jsonSchema) ? jsonSchema[this.io] : this.converted(schema, standard)
    if (!isGenerateJsonSchema(generate)) {
      throw new OpenAPIGenerationError(
        `${where}: the schema has no JSON Schema (~standard.jsonSchema). Valibot's is written by ` +
          `createRoute() from 'openapi-hono/valibot' (@valibot/to-json-schema), Effect's by createRoute() from ` +
          `'openapi-hono/effect'.`,
      )
    }
    const libraryOptions = { ...this.libraryOptions, ...(isZod(schema) ? { metadata: this.zodMetadata } : {}) }
    const options: JsonSchemaOptions = {
      target: 'draft-2020-12',
      ...(Object.keys(libraryOptions).length > 0 ? { libraryOptions } : {}),
    }
    // A library that has no 3.0 (ArkType, Effect), or not for this schema (Valibot's `gtValue`), writes
    // 2020-12, which the document turns into 3.0 (openapi30.ts) as it does for every schema.
    const generated =
      (this.target === 'openapi-3.0'
        ? tryGenerateJsonSchema(generate, { ...options, target: this.target })
        : undefined) ?? generateJsonSchema(generate, options, where)
    const { $schema: _dialect, $defs, definitions, ...rest } = generated
    // Zod's names come with the side already (from the metadata); another library's are given it.
    const defsSide = isZod(schema) ? '' : this.side
    for (const [name, def] of [...entriesOf(definitions), ...entriesOf($defs)]) {
      if (UNNAMED.test(name)) throw unnamedRecursion(where)
      this.add('schemas', `${name}${defsSide}`, this.rewriteRefs(def, where, `${name}${defsSide}`, defsSide))
    }
    const rewritten = this.rewriteRefs(rest, where, self, defsSide)
    return isObject(rewritten) ? rewritten : {}
  }

  /** The schema with each part that is a named schema replaced by its `$ref` (`except` itself). */
  private refer(value: unknown, except?: string): unknown {
    // No schema to find by its shape (Zod's are named by Zod): nothing to replace.
    if (this.shapes.size === 0) return value
    if (Array.isArray(value)) return value.map((item) => this.refer(item))
    if (!isObject(value)) return value
    const name = this.shapes.get(`${this.io} ${canonical(value)}`)
    if (name && name !== except) return this.use(name)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.refer(item)]))
  }

  /** A `$ref` to a named schema of another library, written to the components the first time. */
  private use(name: string): Json {
    const schemas = this.components.schemas
    if (!schemas.has(name)) {
      schemas.set(name, {}) // in place first: a schema that refers to itself ends here
      schemas.set(name, this.refer(this.declared.get(name), name))
    }
    return ref('schemas', name)
  }

  /** A schema as a slot holds it: a `$ref` if it was named, its JSON Schema otherwise. */
  schema(schema: unknown, where: string): unknown {
    if (!isZod(schema)) {
      const name = this.nameOf(schema, 'schemas')
      if (name !== undefined) return this.use(`${name}${this.side}`)
    }
    return this.refer(this.jsonSchemaOf(schema, where))
  }

  /** The JSON Schema of an object schema, for its properties: followed through a `$ref`, not named. */
  private objectOf(schema: unknown, where: string): Json {
    this.unnamed = schema
    try {
      const json = this.jsonSchemaOf(schema, where)
      const target = typeof json.$ref === 'string' ? json.$ref.replace(SCHEMA_REF, '') : undefined
      const found = target === undefined ? undefined : this.components.schemas.get(target)
      return isObject(found) ? found : json
    } finally {
      this.unnamed = undefined
    }
  }

  /**
   * The properties of an object schema, each with the named schema it is (if any): a Zod `$ref`
   * told back to its schema, another library's found by its shape.
   */
  private propertiesOf(schema: unknown, where: string) {
    const object = this.objectOf(schema, where)
    const declared: unknown = object.required
    const required: readonly unknown[] = Array.isArray(declared) ? declared : []
    return entriesOf(object.properties).map(([name, property]) => {
      const reference = isObject(property) ? property.$ref : undefined
      const target = typeof reference === 'string' ? reference.replace(SCHEMA_REF, '') : undefined
      const zodNamed = target !== undefined && this.givenSchemas.has(target) ? target : undefined
      const otherNamed =
        zodNamed === undefined && this.parameterShapes.size > 0
          ? this.parameterShapes.get(`${this.io} ${canonical(property)}`)
          : undefined
      const schemaName = zodNamed ?? otherNamed ?? undefined
      const found = zodNamed === undefined ? property : this.components.schemas.get(zodNamed)
      const json: Json = isObject(found) ? found : {}
      const description = json.description
      const examples: unknown = json.examples
      const example: unknown = Array.isArray(examples) ? examples[0] : json.example
      return {
        name,
        required: required.includes(name),
        description: typeof description === 'string' ? description : undefined,
        // What OpenAPI reads on the parameter (or header) itself, not inside its schema.
        lifted: {
          ...(json.deprecated === true ? { deprecated: true } : {}),
          ...(example === undefined ? {} : { example }),
        },
        value: schemaName === undefined ? undefined : this.byName.get(schemaName),
        schema: this.refer(json, schemaName),
      }
    })
  }

  private examples(examples: unknown): unknown {
    if (!isObject(examples)) return examples
    return Object.fromEntries(
      entriesOf(examples).map(([key, example]) => [key, this.named('examples', example, () => example)]),
    )
  }

  private content(content: unknown, where: string): Json {
    return Object.fromEntries(
      entriesOf(content).map(([mediaType, media]) => {
        const { schema, examples, encoding, ...fields }: Json = isObject(media) ? media : {}
        return [
          mediaType,
          {
            ...fields,
            ...(schema === undefined ? {} : { schema: this.schema(schema, `${where} ${mediaType}`) }),
            ...(examples === undefined ? {} : { examples: this.examples(examples) }),
            ...(encoding === undefined ? {} : { encoding: this.encoding(encoding, `${where} ${mediaType}`) }),
          },
        ]
      }),
    )
  }

  private encoding(encoding: unknown, where: string): Json {
    return Object.fromEntries(
      entriesOf(encoding).map(([field, value]) => {
        if (!isObject(value) || value.headers === undefined) return [field, value]
        return [field, { ...value, headers: this.headers(value.headers, `${where} ${field}`) }]
      }),
    )
  }

  private header(header: unknown, where: string): unknown {
    if (!isObject(header)) return header
    const { schema, examples, ...fields } = header
    return {
      ...fields,
      ...(schema === undefined ? {} : { schema: isSchema(schema) ? this.schema(schema, where) : schema }),
      ...(examples === undefined ? {} : { examples: this.examples(examples) }),
    }
  }

  /** A response's headers: an object schema (a header per property), or a Headers Object. */
  private headers(headers: unknown, where: string): Json {
    if (isSchema(headers)) {
      return Object.fromEntries(
        this.propertiesOf(headers, `${where} headers`).map((property) => {
          const write = () => ({
            ...(property.description === undefined ? {} : { description: property.description }),
            ...(property.required ? { required: true } : {}),
            ...property.lifted,
            schema: property.schema,
          })
          return [property.name, property.value === undefined ? write() : this.named('headers', property.value, write)]
        }),
      )
    }
    return Object.fromEntries(
      entriesOf(headers).map(([name, header]) => [
        name,
        this.named('headers', header, () => this.header(header, `${where} header ${name}`)),
      ]),
    )
  }

  private response(response: unknown, where: string): unknown {
    const io = this.io
    this.io = this.responseSchemas
    try {
      return this.writeResponse(response, where)
    } finally {
      this.io = io
    }
  }

  private writeResponse(response: unknown, where: string): unknown {
    return this.named('responses', response, () => {
      const { content, headers, links, ...fields }: Json = isObject(response) ? response : {}
      return {
        ...fields,
        ...(headers === undefined ? {} : { headers: this.headers(headers, where) }),
        ...(content === undefined ? {} : { content: this.content(content, where) }),
        ...(links === undefined
          ? {}
          : {
              links: Object.fromEntries(
                entriesOf(links).map(([key, link]) => [key, this.named('links', link, () => link)]),
              ),
            }),
      }
    })
  }

  /** A request body, required unless declared `required: false` (as the client takes it). */
  private body(body: unknown, where: string): unknown {
    return this.named('requestBodies', body, () => {
      const { content, required, ...fields }: Json = isObject(body) ? body : {}
      return { ...fields, required: required !== false, content: this.content(content, where) }
    })
  }

  /** The parameters: each property of `params` / `query` / `headers` / `cookies`, and the template's. */
  private parameters(
    request: Request | undefined,
    path: string | undefined,
    declared: unknown,
    where: string,
  ): unknown[] {
    const templateNames = new Set([...(path ?? '').matchAll(/\{([^}]+)\}/gu)].map(([, name]) => name))
    const parameters: { readonly name: string; readonly in: string; written: unknown }[] = []
    for (const [part, location] of LOCATIONS) {
      const schema = request?.[part]
      if (schema === undefined) continue
      for (const property of this.propertiesOf(schema, `${where} ${part}`)) {
        // A path parameter the template does not have makes the document invalid.
        if (location === 'path' && path !== undefined && !templateNames.has(property.name)) {
          throw new OpenAPIGenerationError(
            `${where}: the path parameter "${property.name}" is not in the path template (${path})`,
          )
        }
        const write = () => ({
          name: property.name,
          in: location,
          required: location === 'path' || property.required,
          ...(property.description === undefined ? {} : { description: property.description }),
          ...property.lifted,
          schema: property.schema,
        })
        const written = property.value === undefined ? write() : this.named('parameters', property.value, write)
        parameters.push({ name: property.name, in: location, written })
      }
    }
    for (const [, name] of (path ?? '').matchAll(/\{([^}]+)\}/gu)) {
      if (name === undefined) continue
      if (!parameters.some((p) => p.in === 'path' && p.name === name)) {
        parameters.push({
          name,
          in: 'path',
          written: { name, in: 'path', required: true, schema: { type: 'string' } },
        })
      }
    }
    // The operation's own parameters, merged over the ones its parts make (same name and
    // location: its fields win).
    for (const parameter of Array.isArray(declared) ? declared : []) {
      const written = this.parameter(parameter, where)
      const name = isObject(parameter) ? parameter.name : undefined
      const location = isObject(parameter) ? parameter.in : undefined
      const same = parameters.find((p) => p.name === name && p.in === location)
      if (same === undefined) parameters.push({ name: String(name), in: String(location), written })
      else {
        same.written =
          isObject(same.written) && !('$ref' in same.written) && isObject(written)
            ? { ...same.written, ...written }
            : written
      }
    }
    return parameters.map((parameter) => parameter.written)
  }

  private parameter(parameter: unknown, where: string): unknown {
    return this.named('parameters', parameter, () => {
      if (!isObject(parameter)) return parameter
      const { schema, examples, content, ...fields } = parameter
      return {
        ...fields,
        ...(schema === undefined
          ? {}
          : { schema: isSchema(schema) ? this.schema(schema, `${where} ${String(fields.name)}`) : schema }),
        ...(examples === undefined ? {} : { examples: this.examples(examples) }),
        ...(content === undefined ? {} : { content: this.content(content, where) }),
      }
    })
  }

  /** Path-level fields: `parameters` converted as an operation's are, the others as they are. */
  pathFields(fields: unknown, where: string): Json {
    const { parameters, ...rest }: Json = isObject(fields) ? fields : {}
    return {
      ...rest,
      ...(Array.isArray(parameters)
        ? { parameters: parameters.map((parameter) => this.parameter(parameter, where)) }
        : {}),
    }
  }

  operation(operation: OperationLike, where: string): Json {
    const {
      method: _method,
      path,
      request,
      responses,
      callbacks,
      components: _components,
      parameters: declared,
      ...fields
    } = operation
    const operationId = fields.operationId
    if (typeof operationId === 'string') {
      const other = this.operationIds.get(operationId)
      if (other !== undefined) {
        throw new OpenAPIGenerationError(`The operationId "${operationId}" is used by both ${other} and ${where}`)
      }
      this.operationIds.set(operationId, where)
    }
    const parameters = this.parameters(request, path, declared, where)
    return {
      ...fields,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(request?.body === undefined ? {} : { requestBody: this.body(request.body, `${where} body`) }),
      responses: Object.fromEntries(
        entriesOf(responses).map(([status, response]) => [status, this.response(response, `${where} ${status}`)]),
      ),
      ...(callbacks === undefined ? {} : { callbacks: this.callbacks(callbacks, where) }),
    }
  }

  /** A Path Item: a route (its one operation), or operations by method, written as routes are. */
  pathItem(item: unknown, where: string): unknown {
    return this.named('pathItems', item, () => {
      if (!isObject(item)) return item
      if (typeof item.method === 'string') {
        return { [item.method.toLowerCase()]: this.operation(item, where) }
      }
      return Object.fromEntries(
        Object.entries(item).map(([key, value]) => [
          key,
          METHODS.has(key) && isObject(value) ? this.operation(value, `${where} ${key}`) : value,
        ]),
      )
    })
  }

  private callbacks(callbacks: unknown, where: string): Json {
    return Object.fromEntries(
      entriesOf(callbacks).map(([name, callback]) => [
        name,
        this.named('callbacks', callback, () =>
          Object.fromEntries(
            entriesOf(callback).map(([expression, item]) => [
              expression,
              this.pathItem(item, `${where} callback ${name} ${expression}`),
            ]),
          ),
        ),
      ]),
    )
  }

  /**
   * `UserOutput` merged into `User` when the two are the same (their own references merged first),
   * renamed `User` when there is no `User`. Returns the renames.
   */
  mergeOutputs(): ReadonlyMap<string, string> {
    const schemas = this.components.schemas
    const renames = new Map<string, string>()
    const renamed = (value: unknown) => renameRefs(value, renames)
    for (let changed = true; changed;) {
      changed = false
      for (const name of schemas.keys()) {
        if (!name.endsWith(OUTPUT) || renames.has(name)) continue
        const base = name.slice(0, -OUTPUT.length)
        const same =
          !schemas.has(base) ||
          canonical(unstrict(renamed(schemas.get(name)))) === canonical(unstrict(renamed(schemas.get(base))))
        if (same) {
          renames.set(name, base)
          changed = true
        }
      }
    }
    for (const [from, to] of renames) {
      if (!schemas.has(to)) schemas.set(to, schemas.get(from))
      schemas.delete(from)
      if (this.givenSchemas.has(from)) this.givenSchemas.add(to)
    }
    for (const kind of KINDS) {
      for (const [name, value] of this.components[kind]) this.components[kind].set(name, renamed(value))
    }
    return renames
  }

  /** Drops each schema named in `components` that nothing refers to (one used as a parameter, say). */
  prune(document: Json): void {
    const schemas = this.components.schemas
    // The other kinds of components refer to schemas as the document does.
    const others: unknown[] = []
    for (const kind of KINDS) if (kind !== 'schemas') others.push(...this.components[kind].values())
    const referred = refsIn({ ...document, components: others }, new Set())
    const kept = new Set<string>()
    const keep = (name: string) => {
      if (kept.has(name) || !schemas.has(name)) return
      kept.add(name)
      for (const found of refsIn(schemas.get(name), new Set())) {
        if (found.startsWith(SCHEMA_REF)) keep(found.slice(SCHEMA_REF.length))
      }
    }
    for (const found of referred) if (found.startsWith(SCHEMA_REF)) keep(found.slice(SCHEMA_REF.length))
    for (const name of schemas.keys()) if (!this.givenSchemas.has(name)) keep(name)
    for (const name of schemas.keys()) if (!kept.has(name)) schemas.delete(name)
  }
}

/** The JSON Schema in a dialect the library may not have: nothing when it throws. */
function tryGenerateJsonSchema(generate: GenerateJsonSchema, options: JsonSchemaOptions): Json | undefined {
  try {
    return generate(options)
  } catch {
    return undefined
  }
}

function generateJsonSchema(generate: GenerateJsonSchema, options: JsonSchemaOptions, where: string): Json {
  try {
    return generate(options)
  } catch (error) {
    if (error instanceof OpenAPIGenerationError) throw error
    // The library's own message (Zod's `Date cannot be represented in JSON Schema`), and where.
    throw new OpenAPIGenerationError(`${where}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}
