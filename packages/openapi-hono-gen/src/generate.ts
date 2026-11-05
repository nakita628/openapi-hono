/** The routes file of an OpenAPI document, and as the config asks the app entry, the handlers and the client. */

import { posix } from 'node:path'

import { Effect, Schema } from 'effect'
import {
  isParamStyle,
  makeAdapter,
  makeCallbacksDeclarations,
  makeExamplesDeclarations,
  makeHeadersDeclarations,
  makeLinksDeclarations,
  makeMediaTypesDeclarations,
  makeParametersDeclarations,
  makePathItemsDeclarations,
  makeRequestBodiesDeclarations,
  makeResponsesDeclarations,
  makeSafeKey,
  makeSchemaDeclarations,
  makeSecuritySchemesDeclarations,
  schemaImportLine,
} from 'oas-truth'
import type { OpenAPI, Schema as JsonSchema } from 'oas-truth'
import { format } from 'oxfmt'
import type { FormatConfig } from 'oxfmt'

import type { Config, SchemaLibrary } from './config.js'
import { handlersIn, merge } from './merge.js'

type Json = { readonly [key: string]: unknown }

const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const isJsonSchema = (value: unknown): value is JsonSchema => isJson(value)

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

type Method = (typeof METHODS)[number]

type Location = 'path' | 'query' | 'header' | 'cookie'

const LOCATIONS: readonly Location[] = ['path', 'query', 'header', 'cookie']

const isLocation = (value: unknown): value is Location => LOCATIONS.some((location) => location === value)

const PART: Readonly<Record<Location, string>> = {
  path: 'params',
  query: 'query',
  header: 'headers',
  cookie: 'cookies',
}

/** The media types whose body arrives as text, field by field: coerced as a parameter is. */
const FORM = /^(?:multipart\/form-data|application\/x-www-form-urlencoded)$/iu

type Parameter = {
  /** The component it is a `$ref` to, if it is one. */
  readonly ref?: string
  readonly name: string
  readonly in: Location
  readonly required: boolean
  readonly schema: JsonSchema
  readonly style?: string
  readonly explode?: boolean
  readonly allowEmptyValue?: boolean
}

/** What a local `$ref` points to; anything else as it is. */
function deref(document: OpenAPI, value: unknown, seen: ReadonlySet<string> = new Set()): unknown {
  if (!isJson(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value
  const ref = value.$ref
  if (seen.has(ref)) throw new Error(`The $ref ${ref} refers to itself`)
  const target = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((node, segment) => (isJson(node) ? node[segment] : undefined), document)
  if (target === undefined) throw new Error(`The $ref ${ref} points to nothing`)
  return deref(document, target, new Set([...seen, ref]))
}

/** The component a `$ref` names, of the kind: `#/components/responses/Error` is `Error`. */
function refOf(value: unknown, kind: string): string | undefined {
  const prefix = `#/components/${kind}/`
  if (!isJson(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith(prefix)) return undefined
  return value.$ref.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~')
}

function parameterOf(document: OpenAPI, value: unknown): Parameter | undefined {
  const ref = refOf(value, 'parameters')
  const parameter = deref(document, value)
  if (!isJson(parameter) || typeof parameter.name !== 'string' || !isLocation(parameter.in)) return undefined
  const schema = isJsonSchema(parameter.schema) ? parameter.schema : {}
  return {
    ...(ref === undefined ? {} : { ref }),
    // Hono reads the headers by their lowercase name.
    name: parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name,
    in: parameter.in,
    required: parameter.in === 'path' || parameter.required === true,
    schema,
    ...(typeof parameter.style === 'string' ? { style: parameter.style } : {}),
    ...(typeof parameter.explode === 'boolean' ? { explode: parameter.explode } : {}),
    ...(typeof parameter.allowEmptyValue === 'boolean' ? { allowEmptyValue: parameter.allowEmptyValue } : {}),
  }
}

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/** The parameters of an operation: the Path Item's, then the operation's own over them. */
function parametersOf(document: OpenAPI, shared: unknown, own: unknown): Parameter[] {
  const list = [...listOf(shared), ...listOf(own)]
  const byKey = new Map<string, Parameter>()
  for (const value of list) {
    const parameter = parameterOf(document, value)
    if (parameter !== undefined) byKey.set(`${parameter.in} ${parameter.name}`, parameter)
  }
  return [...byKey.values()]
}

/** `get-todo_by id` as `GetTodoById`. */
const pascal = (text: string) =>
  text
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('')

const camel = (text: string) => {
  const name = pascal(text)
  const identifier = `${name.charAt(0).toLowerCase()}${name.slice(1)}`
  return /^[A-Za-z_$]/u.test(identifier) ? identifier : `_${identifier}`
}

/** An operation without an operationId is named by its method and path: `getTodosTodoId`. */
const nameOf = (method: Method, path: string) => camel(`${method} ${path.replaceAll(/[{}]/gu, '')}`)

/** The group of a path: its first segment (`/books/{id}` is `books`), `index` for the root. */
const groupOf = (path: string) => {
  const first = path.split('/').find((segment) => segment !== '') ?? ''
  return first === '' || first.startsWith('{') ? 'index' : camel(first)
}

/** `name`, or `name2`, `name3`, ... when it is taken. */
function claim(name: string, taken: Set<string>): string {
  let candidate = name
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${name}${String(n)}`
  taken.add(candidate)
  return candidate
}

/**
 * Each entry on its own line: oxfmt keeps an object open (`objectWrap: 'preserve'`) when its first
 * entry starts on a new line, so the routes read field by field.
 */
const block = (entries: readonly string[]) => (entries.length === 0 ? '{}' : `{\n${entries.join(',\n')},\n}`)

const literal = (value: unknown): string =>
  isJson(value)
    ? block(Object.entries(value).map(([key, item]) => `${makeSafeKey(key)}: ${JSON.stringify(item)}`))
    : JSON.stringify(value)

/** A component schema's declaration, its outermost object open over lines as well. */
const OUTER_OBJECT = /(=\s*(?:z\.object|v\.object|Schema\.Struct|type)\(\{)(?!\})/u

type Field = { readonly key: string; readonly expression: string; readonly required: boolean }

type Library = {
  readonly object: (fields: readonly Field[]) => string
  /** A schema as the document's `components.schemas` names it. */
  readonly named: (expression: string) => string
  readonly createRoute: string
  /** A component schema's declaration, named as the document names it. */
  readonly declaration?: (expression: string, name: string) => string
}

const fieldsOf = (fields: readonly Field[], optional: (field: Field) => string) =>
  fields.map((field) => `${makeSafeKey(field.key)}: ${field.required ? field.expression : optional(field)}`)

const LIBRARIES: Readonly<Record<SchemaLibrary, Library>> = {
  zod: {
    object: (fields) => `z.object(${block(fieldsOf(fields, (field) => `${field.expression}.exactOptional()`))})`,
    named: (expression) => expression,
    createRoute: "import { createRoute } from 'openapi-hono'",
  },
  valibot: {
    object: (fields) => `v.object(${block(fieldsOf(fields, (field) => `v.optional(${field.expression})`))})`,
    // openapi-hono/valibot writes the JSON Schema of Valibot's schemas as they are.
    named: (expression) => expression,
    createRoute: "import { createRoute } from 'openapi-hono/valibot'",
  },
  arktype: {
    object: (fields) =>
      `type(${block(
        fields.map((field) => `${makeSafeKey(field.required ? field.key : `${field.key}?`)}: ${field.expression}`),
      )})`,
    named: (expression) => expression,
    createRoute: "import { createRoute } from 'openapi-hono'",
  },
  effect: {
    object: (fields) =>
      `Schema.Struct(${block(fieldsOf(fields, (field) => `Schema.optionalKey(${field.expression})`))})`,
    // createRoute() from openapi-hono/effect makes each schema of a route a Standard Schema.
    named: (expression) => `Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(${expression}))`,
    createRoute: "import { createRoute } from 'openapi-hono/effect'",
    // Effect's JSON Schema names a schema by its identifier: a recursive one is named so, too.
    declaration: (expression, name) => `${expression}.annotate({ identifier: ${literal(name)} })`,
  },
}

/** Effect's names as the code uses them (`SchemaTransformation`). */
function libraryImport(library: SchemaLibrary, importLine: string, code: string): string[] {
  if (library !== 'effect') return [importLine]
  const names = new Set(['Schema', ...[...code.matchAll(/\b(Schema[A-Z]\w*)\./gu)].flatMap(([, name]) => name ?? [])])
  return [`import { ${[...names].toSorted().join(', ')} } from 'effect'`]
}

type Route = {
  readonly name: string
  /** The group of its path (`split`): `books` for `/books/{id}`. */
  readonly group: string
  /** The handler file it goes to, by its first tag (`handlers/books.ts`), or by its group. */
  readonly file: string
  readonly code: string
}

const fileNameOf = (tag: string) => camel(tag)

const OPERATION_FIELDS = ['tags', 'summary', 'description', 'externalDocs', 'deprecated', 'security'] as const

/** Not formatted yet. `located` is where each handler already is, so that one the user has moved stays there. */
function generateFiles(
  document: OpenAPI,
  config: Config,
  located: ReadonlyMap<string, string> = new Map(),
  handlerFiles: readonly string[] = [],
): Map<string, string> {
  const library = LIBRARIES[config.schema]
  const adapter = makeAdapter(config.schema)
  const expression = (schema: JsonSchema, paramIn?: Parameter['in'] | 'formData', options?: Partial<Parameter>) =>
    adapter.toExpression(schema, paramIn, {
      ...(options?.style !== undefined && isParamStyle(options.style) ? { style: options.style } : {}),
      ...(options?.explode === undefined ? {} : { explode: options.explode }),
      ...(options?.allowEmptyValue === undefined ? {} : { allowEmptyValue: options.allowEmptyValue }),
    })

  // The component schemas, in the order they refer to one another.
  const components = document.components ?? {}
  const schemas = components.schemas ?? {}
  const wrapDeclaration = library.declaration
  const declarations = makeSchemaDeclarations(schemas, adapter, {
    ...(wrapDeclaration === undefined ? {} : { wrapDeclaration }),
    exportTypes: config.exportSchemasTypes,
  })
  const baseImport = schemaImportLine(adapter)
  const cyclic = declarations.some((declaration) => declaration.importLine !== baseImport)

  const content = (media: unknown, form: boolean) =>
    Object.entries(isJson(media) ? media : {}).flatMap(([mediaType, value]) => {
      const entry = deref(document, value)
      if (!isJson(entry) || !isJsonSchema(entry.schema)) return []
      const schema = expression(entry.schema, form && FORM.test(mediaType) ? 'formData' : undefined)
      return [`${literal(mediaType)}: { schema: ${schema} }`]
    })

  /** A Request Body Object as openapi-hono's route takes it; its form fields coerced from text. */
  const bodyObject = (body: Json) => {
    const media = content(body.content, true)
    return block([`required: ${String(body.required === true)}`, `content: ${block(media)}`])
  }

  const responseObject = (response: Json) => {
    const media = content(response.content, false)
    const description = `description: ${literal(typeof response.description === 'string' ? response.description : '')}`
    return block([description, ...(media.length > 0 ? [`content: ${block(media)}`] : [])])
  }

  // The request bodies and the responses are written as the routes take them (a form's fields coerced).
  const parameterVars = new Map(
    makeParametersDeclarations(components, adapter).map((declaration) => [declaration.name, declaration.varName]),
  )
  const requestBodies = makeRequestBodiesDeclarations(components, adapter).flatMap((declaration) => {
    const body = deref(document, components.requestBodies?.[declaration.name])
    return isJson(body) ? [{ ...declaration, code: `export const ${declaration.varName} = ${bodyObject(body)}` }] : []
  })
  const responses = makeResponsesDeclarations(components, adapter).flatMap((declaration) => {
    const response = deref(document, components.responses?.[declaration.name])
    return isJson(response)
      ? [{ ...declaration, code: `export const ${declaration.varName} = ${responseObject(response)}` }]
      : []
  })
  const requestBodyVars = new Map(requestBodies.map((declaration) => [declaration.name, declaration.varName]))
  const responseVars = new Map(responses.map((declaration) => [declaration.name, declaration.varName]))
  const securitySchemes = makeSecuritySchemesDeclarations(components)

  // What a route names in its `components`, so that the document refers to them by `$ref` with no
  // config of the app's: the schemas its code uses (and the schemas they use), by their names in
  // the document, and the security schemes its security (or the document's) requires.
  const schemaCode = new Map<string, { readonly name: string; readonly code: string }>(
    [...declarations, ...requestBodies, ...responses].map((declaration) => [
      declaration.varName,
      { name: declaration.name, code: declaration.code },
    ]),
  )
  const schemaVars = new Set(declarations.map((declaration) => declaration.varName))
  const usedIn = (code: string) =>
    [...code.matchAll(/\b[A-Za-z_$][\w$]*\b/gu)].map(([word]) => word).filter((word) => schemaCode.has(word))
  const componentsOf = (code: string, security: unknown): string[] => {
    const found = new Set<string>()
    const visit = (text: string) => {
      for (const varName of usedIn(text)) {
        if (found.has(varName)) continue
        found.add(varName)
        visit(schemaCode.get(varName)?.code ?? '')
      }
    }
    visit(code)
    const schemaEntries = [...found]
      .filter((varName) => schemaVars.has(varName))
      .map((varName) => {
        const { name } = schemaCode.get(varName) ?? { name: varName }
        // Named by its key, the kind's suffix dropped: `HonoSchema` is `Hono`.
        return varName === `${name}Schema` ? varName : `${makeSafeKey(`${name}Schema`)}: ${varName}`
      })
    const required = new Set(
      listOf(security).flatMap((requirement) => (isJson(requirement) ? Object.keys(requirement) : [])),
    )
    const schemeEntries = securitySchemes
      .filter((declaration) => required.has(declaration.name))
      .map((declaration) => `${makeSafeKey(declaration.name)}: ${declaration.varName}`)
    return [...schemaEntries, ...schemeEntries]
  }
  const componentSections = [
    [declarations, config.exportSchemas],
    [
      makeParametersDeclarations(components, adapter, { exportTypes: config.exportParametersTypes }),
      config.exportParameters,
    ],
    [makeHeadersDeclarations(components, adapter, { exportTypes: config.exportHeadersTypes }), config.exportHeaders],
    [makeExamplesDeclarations(components), config.exportExamples],
    [makeLinksDeclarations(components), config.exportLinks],
    [securitySchemes, config.exportSecuritySchemes],
    [requestBodies, config.exportRequestBodies],
    [responses, config.exportResponses],
    [makeCallbacksDeclarations(components, adapter), config.exportCallbacks],
    [makePathItemsDeclarations(components, adapter), config.exportPathItems],
    [
      makeMediaTypesDeclarations(components, adapter, { exportTypes: config.exportMediaTypesTypes }),
      config.exportMediaTypes,
    ],
  ] as const
  const componentCode = componentSections
    .map(([list, exported]) =>
      list
        .map((declaration) => {
          const code = declaration.code.replace(OUTER_OBJECT, '$1\n')
          // Only the value: a `*Types` flag's `export type` stays as it is.
          return exported ? code : code.replaceAll(/^export const /gmu, 'const ')
        })
        .join('\n\n'),
    )
    .filter((section) => section !== '')
    .join('\n\n')

  const taken = new Set<string>()
  const routes: Route[] = []
  for (const [path, value] of Object.entries(document.paths)) {
    const item = deref(document, value)
    if (!isJson(item)) continue
    for (const method of METHODS) {
      const operation = deref(document, item[method])
      if (!isJson(operation)) continue
      const declared = typeof operation.operationId === 'string' ? operation.operationId : undefined
      const operationId = declared ?? (config.client?.mode === 'operation' ? nameOf(method, path) : undefined)
      const name = claim(`${declared === undefined ? nameOf(method, path) : camel(declared)}Route`, taken)

      const parameters = parametersOf(document, item.parameters, operation.parameters)
      const request = LOCATIONS.flatMap((location) => {
        const fields = parameters
          .filter((parameter) => parameter.in === location)
          .map((parameter) => ({
            key: parameter.name,
            // A `$ref` to a parameter is its component (coerced from text as the inline one is).
            expression:
              (parameter.ref === undefined ? undefined : parameterVars.get(parameter.ref)) ??
              expression(parameter.schema, location, parameter),
            required: parameter.required,
          }))
        return fields.length === 0 ? [] : [`${PART[location]}: ${library.object(fields)}`]
      })
      // The request bodies and the responses the route refers to, named as the document names them.
      const named: string[] = []
      const bodyRef = refOf(operation.requestBody, 'requestBodies')
      const bodyVar = bodyRef === undefined ? undefined : requestBodyVars.get(bodyRef)
      const body = deref(document, operation.requestBody)
      if (bodyVar !== undefined) {
        request.push(`body: ${bodyVar}`)
        named.push(bodyVar)
      } else if (isJson(body) && content(body.content, true).length > 0) {
        request.push(`body: ${bodyObject(body)}`)
      }

      const routeResponses = Object.entries(isJson(operation.responses) ? operation.responses : {}).map(
        ([status, response]) => {
          const key = /^\d+$/u.test(status) ? status : literal(status)
          const responseRef = refOf(response, 'responses')
          const responseVar = responseRef === undefined ? undefined : responseVars.get(responseRef)
          if (responseVar !== undefined) {
            if (!named.includes(responseVar)) named.push(responseVar)
            return `${key}: ${responseVar}`
          }
          const resolved = deref(document, response)
          return `${key}: ${responseObject(isJson(resolved) ? resolved : {})}`
        },
      )

      const fields = [
        `method: ${literal(method)}`,
        `path: ${literal(path)}`,
        ...(operationId === undefined ? [] : [`operationId: ${literal(operationId)}`]),
        ...OPERATION_FIELDS.flatMap((field) =>
          operation[field] === undefined ? [] : [`${field}: ${literal(operation[field])}`],
        ),
        ...(request.length > 0 ? [`request: ${block(request)}`] : []),
        `responses: ${block(routeResponses)}`,
      ]
      const given = [
        ...named,
        ...componentsOf(fields.join('\n'), operation.security ?? document.security).filter(
          (entry) => !named.includes(entry),
        ),
      ]
      if (given.length > 0) fields.push(`components: { ${given.join(', ')} }`)
      const tag = listOf(operation.tags).find((entry) => typeof entry === 'string')
      routes.push({
        name,
        group: groupOf(path),
        file: typeof tag === 'string' ? fileNameOf(tag) : groupOf(path) === 'index' ? 'root' : groupOf(path),
        code: `export const ${name} = createRoute(${block(fields)})`,
      })
    }
  }

  const libraryImports = (code: string) =>
    libraryImport(config.schema, schemaImportLine(adapter, undefined, cyclic), code)
  return filesOf({
    config,
    library,
    routes,
    componentCode,
    libraryImports,
    located,
    handlerFiles,
  })
}

function relativeSpecifier(from: string, to: string): string {
  const relative = posix.relative(posix.dirname(from), to).replace(/\.ts$/u, '.js')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * `pathAlias` (`@/routes.js`) between two files in the directory of `output` (the root the alias
 * maps to), relatively otherwise (a client written into another package).
 */
function specifierOf(config: Config) {
  const root = posix.dirname(posix.normalize(config.output))
  const within = (file: string) => !posix.relative(root, file).startsWith('..')
  return (from: string, to: string): string =>
    config.pathAlias !== undefined && within(from) && within(to)
      ? `${config.pathAlias}${posix.relative(root, to).replace(/\.ts$/u, '.js')}`
      : relativeSpecifier(from, to)
}

const sourceOf = (imports: readonly string[], sections: readonly string[]) =>
  `${imports.join('\n')}\n\n${sections.filter((section) => section !== '').join('\n\n')}\n`

const named = (names: readonly string[]) => `{ ${names.join(', ')} }`

type Parts = {
  readonly config: Config
  readonly library: Library
  readonly routes: readonly Route[]
  readonly componentCode: string
  readonly libraryImports: (code: string) => string[]
  readonly located: ReadonlyMap<string, string>
  /** The handler files there already: each stays in the barrel. */
  readonly handlerFiles: readonly string[]
}

/** The paths of the files, from `output`: the app entry and the handlers next to it. */
export function pathsOf(config: Config) {
  const routes = posix.normalize(config.output)
  const directory = posix.dirname(routes)
  return {
    routes,
    index: posix.join(directory, 'index.ts'),
    handlers: posix.join(directory, 'handlers'),
    client: config.client === undefined ? undefined : posix.normalize(config.client.output),
  }
}

function filesOf({ config, library, routes, componentCode, libraryImports, located, handlerFiles }: Parts) {
  const paths = pathsOf(config)
  const specifier = specifierOf(config)
  const files = new Map<string, string>()
  const groups = Map.groupBy(routes, (route) => route.group)

  // The document's config is the user's.
  const routesBody = [componentCode, routes.map((route) => route.code).join('\n\n')].join('\n\n')
  files.set(paths.routes, sourceOf([library.createRoute, ...libraryImports(routesBody)], [routesBody]))

  if (config.template) {
    const barrel = posix.join(paths.handlers, 'index.ts')
    const byFile = Map.groupBy(
      routes,
      (route) => located.get(`${route.name}Handler`) ?? posix.join(paths.handlers, `${route.file}.ts`),
    )
    for (const [file, list] of byFile) {
      files.set(
        file,
        sourceOf(
          [
            "import type { RouteHandler } from 'openapi-hono'",
            `import type ${named(list.map((route) => route.name))} from '${specifier(file, paths.routes)}'`,
          ],
          // Empty, as hono-takibi writes it: the handler is yours to write.
          list.map(
            (route) => `export const ${route.name}Handler: RouteHandler<typeof ${route.name}> = async (c) => {}`,
          ),
        ),
      )
    }
    const handlerModules = [...new Set([...byFile.keys(), ...located.values(), ...handlerFiles])]
      .filter((file) => posix.dirname(file) === paths.handlers && file !== barrel)
      .toSorted()
    files.set(
      barrel,
      `${handlerModules.map((file) => `export * from '${relativeSpecifier(barrel, file)}'`).join('\n')}\n`,
    )

    // The document is the user's to serve.
    const registered = (list: readonly Route[]) =>
      list.map((route) => `.openapi(${route.name}, ${route.name}Handler)`).join('')
    // As hono-takibi writes it: the routes registered on one app, `api` (each group's with `split`)
    // exported for the type of the client, the app for the server.
    const apis = config.split
      ? [...groups].map(([group, list]) => `export const ${group}Api = app${registered(list)}`)
      : [`export const api = app${registered(routes)}`]
    files.set(
      paths.index,
      sourceOf(
        [
          "import { Hono } from 'hono'",
          `import ${named(routes.map((route) => `${route.name}Handler`))} from '${specifier(paths.index, barrel)}'`,
          `import ${named(routes.map((route) => route.name))} from '${specifier(paths.index, paths.routes)}'`,
        ],
        ['const app = new Hono()', ...apis, 'export default app'],
      ),
    )
  }

  if (config.client !== undefined && paths.client !== undefined) {
    const file = paths.client
    const clients = config.split
      ? [...groups].map(([group, list]) => ({ name: `create${pascal(group)}Client`, group, list }))
      : [{ name: 'createApiClient', group: undefined, list: routes }]
    const options = "import type { ClientRequestOptions } from 'hono/client'"
    if (config.client.mode === 'hc') {
      // As the `hcWithType` of the Hono guide (and hono-takibi): the type of the client declared
      // once, so that it is worked out when this file is compiled, not by every file that calls it.
      const hcClients = clients.map((client) => {
        const app = client.group === undefined ? 'api' : `${client.group}Api`
        const name = client.group === undefined ? 'client' : `${client.group}Client`
        const type = `${name.charAt(0).toUpperCase()}${name.slice(1)}`
        const factory = client.group === undefined ? 'hcWithType' : `hc${pascal(client.group)}WithType`
        return {
          app,
          code: [
            `type ${type} = ReturnType<typeof hc<typeof ${app}>>`,
            `const ${factory} = (...args: Parameters<typeof hc>): ${type} => hc<typeof ${app}>(...args)`,
            `export const ${name} = ${factory}(${literal(config.client?.baseUrl ?? '/')})`,
          ].join('\n\n'),
        }
      })
      files.set(
        file,
        sourceOf(
          [
            "import { hc } from 'hono/client'",
            `import type ${named(hcClients.map((client) => client.app))} from '${specifier(file, paths.index)}'`,
          ],
          hcClients.map((client) => client.code),
        ),
      )
    } else {
      files.set(
        file,
        sourceOf(
          [
            options,
            "import { createClient } from 'openapi-hono/client'",
            `import ${named(routes.map((route) => route.name))} from '${specifier(file, paths.routes)}'`,
          ],
          clients.map((client) => {
            const routesName = client.group === undefined ? 'routes' : `${client.group}Routes`
            return (
              `export const ${routesName} = ${block(client.list.map((route) => route.name))}\n\n` +
              `export const ${client.name} = (baseUrl: string, options?: ClientRequestOptions) =>\n` +
              `  createClient(${routesName}, baseUrl, options)`
            )
          }),
        ),
      )
    }
  }
  return files
}

// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError()` is the class factory, not a throw
export class GenerateError extends Schema.TaggedError<GenerateError>()('GenerateError', {
  message: Schema.String,
}) {}

const FORMAT: FormatConfig = { printWidth: 100, singleQuote: true, semi: false }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const attempt = <A>(run: () => A) =>
  Effect.try({ try: run, catch: (error) => new GenerateError({ message: messageOf(error) }) })

function formatted(source: string, file: string, config: Config) {
  return Effect.gen(function* () {
    const { code, errors } = yield* Effect.tryPromise({
      try: () => format(file, source, { ...FORMAT, ...config.format }),
      catch: (error) => new GenerateError({ message: messageOf(error) }),
    })
    if (errors.length > 0) {
      return yield* new GenerateError({ message: `${file}: ${errors.map((error) => error.message).join('\n')}` })
    }
    return code
  })
}

/**
 * `existing` (the app entry, the handlers) is merged into (see merge.ts), so that the user's code
 * stays. The routes file and the client are written anew.
 */
export function generate(document: OpenAPI, config: Config, existing: ReadonlyMap<string, string> = new Map()) {
  return Effect.gen(function* () {
    const paths = pathsOf(config)
    const isHandlerFile = (file: string) => posix.dirname(file) === paths.handlers
    const isMerged = (file: string) => file === paths.index || isHandlerFile(file)

    const located = new Map<string, string>()
    for (const [file, code] of existing) {
      if (!isHandlerFile(file) || posix.basename(file) === 'index.ts') continue
      for (const name of yield* attempt(() => handlersIn(code, file))) located.set(name, file)
    }
    const existingHandlerFiles = [...existing.keys()].filter(isHandlerFile)
    const files = yield* attempt(() => generateFiles(document, config, located, existingHandlerFiles))
    // A handler file no route goes to any more: its handlers go, the rest of it stays.
    for (const file of existing.keys()) if (isHandlerFile(file) && !files.has(file)) files.set(file, '')

    const written = new Map<string, string>()
    for (const [file, generated] of files) {
      const code = generated === '' ? '' : yield* formatted(generated, file, config)
      const before = isMerged(file) ? existing.get(file) : undefined
      written.set(
        file,
        before === undefined ? code : yield* formatted(yield* attempt(() => merge(before, code, file)), file, config),
      )
    }
    return written
  })
}
