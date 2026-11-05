/**
 * The generated file merged into the one already there, read with oxc-parser: what is the user's
 * stays, what is the generator's is written anew.
 *
 * - A handler (`export const xxxRouteHandler`) the user has written keeps its text; a route that
 *   is new gets an empty one, and the handler of a route that is gone goes with it.
 * - The app (`const app = new Hono()`) is the user's once it is there: `new Hono<Env>().use(logger())`
 *   stays. Its registrations (`api`, `xxxApi`) are written anew, so that every route is registered;
 *   what the user put before them (`app.use(timing).openapi(...)`) is kept.
 * - The components, the routes and the clients are the generator's (by their names); any other
 *   statement (a helper, a middleware, a constant) is the user's, kept after the imports, before
 *   what is generated. So is an import of a name the generated file does not import.
 *
 * The text kept is sliced from the file by the positions oxc-parser gives, its comments with it.
 */

import { parseSync } from 'oxc-parser'
import type { ImportDeclaration, Program } from 'oxc-parser'

type Node = Program['body'][number]

type Statement = {
  readonly node: Node
  readonly names: readonly string[]
  /** Its text, with the comments right above it. */
  readonly text: string
}

/** The names the generator writes: components, routes, handlers, apps, clients. */
const OWNED =
  /(?:Schema|Response|RequestBody|Example|Link|SecurityScheme|Callback|PathItem|MediaType|Route|RouteHandler|Routes|Api|Client)$|^(?:app|api|routes)$/u

/** A handler of a route: the user's to write. */
const isHandler = (name: string) => name.endsWith('RouteHandler')

/** The app itself: the user's to set up once it is there. */
const APP = 'app'

/** The registrations on the app: `api`, and each group's with `split`. */
const API = /^(?:api|\w+Api)$/u

/** The names the generated files import from one another: the routes, the handlers, the apps. */
const IMPORTED = /(?:Route|RouteHandler|Api)$|^(?:app|api)$/u

/** Where the registrations of an app begin: what is before is the user's. */
const REGISTRATION = /\.(?:openapi|route|doc)\(/u

const isReexport = (part: string) => /^export \* from [^\n]+$/u.test(part)

class MergeError extends Error {
  override readonly name = 'MergeError'
}

function declaredNames(node: Node): string[] {
  const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node
  if (declaration === null) return []
  if (declaration.type === 'VariableDeclaration') {
    return declaration.declarations.flatMap((declarator) =>
      declarator.id.type === 'Identifier' ? [declarator.id.name] : [],
    )
  }
  if (
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'ClassDeclaration' ||
    declaration.type === 'TSTypeAliasDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration' ||
    declaration.type === 'TSEnumDeclaration'
  ) {
    return declaration.id === null ? [] : [declaration.id.name]
  }
  return []
}

/** The top-level statements of a file, each with the comments above it. */
function statementsOf(source: string, file: string): Statement[] {
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) {
    const [first] = errors
    throw new MergeError(`${file} cannot be read, so it is not overwritten: ${first?.message ?? ''}`)
  }
  let previous = 0
  return program.body.map((node) => {
    const text = source
      .slice(previous, node.end)
      .replace(/^\s*\n/u, '')
      .trimStart()
    previous = node.end
    return { node, names: declaredNames(node), text }
  })
}

function initializerOf(statement: Statement, source: string): string | undefined {
  const declaration = statement.node.type === 'ExportNamedDeclaration' ? statement.node.declaration : statement.node
  if (declaration?.type !== 'VariableDeclaration') return undefined
  const init = declaration.declarations[0]?.init
  return init === null || init === undefined ? undefined : source.slice(init.start, init.end)
}

const localNames = (node: ImportDeclaration) => node.specifiers.map((specifier) => specifier.local.name)

/** An import of the user's, without the names the generated file imports: `undefined` when none is left. */
function userImport(
  node: ImportDeclaration,
  source: string,
  imported: ReadonlySet<string>,
  generatedSources: ReadonlySet<string>,
): string | undefined {
  const text = source.slice(node.start, node.end)
  // A side-effect import (`import './env'`) is the user's as it is.
  if (node.specifiers.length === 0) return text
  // A route, a handler or an app from a module of the generator's (`../routes.js`, `@/routes.js`) is
  // its to import: one the generated file no longer imports (a route that is gone) is dropped. A
  // component the user imports (`HonoSchema`) is theirs.
  const generators = node.source.value.startsWith('.') || generatedSources.has(node.source.value)
  const kept = node.specifiers.filter(
    (specifier) => !imported.has(specifier.local.name) && !(generators && IMPORTED.test(specifier.local.name)),
  )
  if (kept.length === 0) return undefined
  if (kept.length === node.specifiers.length) return text
  const head = kept.flatMap((specifier) =>
    specifier.type === 'ImportSpecifier' ? [] : [source.slice(specifier.start, specifier.end)],
  )
  const named = kept.flatMap((specifier) =>
    specifier.type === 'ImportSpecifier' ? [source.slice(specifier.start, specifier.end)] : [],
  )
  const clauses = [...head, ...(named.length > 0 ? [`{ ${named.join(', ')} }`] : [])]
  return `import ${node.importKind === 'type' ? 'type ' : ''}${clauses.join(', ')} from ${JSON.stringify(node.source.value)}`
}

export function merge(existing: string, generated: string, file: string): string {
  const old = statementsOf(existing, file)
  const fresh = statementsOf(generated, file)
  const generatedNames = new Set(fresh.flatMap((statement) => statement.names))
  const generatedSources = new Set(
    fresh.flatMap((statement) => (statement.node.type === 'ImportDeclaration' ? [statement.node.source.value] : [])),
  )
  const imported = new Set(
    fresh.flatMap((statement) => (statement.node.type === 'ImportDeclaration' ? localNames(statement.node) : [])),
  )
  const oldByName = new Map(old.flatMap((statement) => statement.names.map((name) => [name, statement] as const)))

  // The generated statements: a handler the user has written as they wrote it, an app with what
  // they put before its registrations.
  const body = fresh.map((statement) => {
    const [name] = statement.names
    const before = name === undefined ? undefined : oldByName.get(name)
    if (name === undefined || before === undefined) return statement.text
    if (isHandler(name) || name === APP) return before.text
    if (API.test(name)) {
      const init = initializerOf(before, existing)
      const at = init?.search(REGISTRATION) ?? -1
      const prefix = init === undefined || at <= 0 ? undefined : init.slice(0, at).trim()
      if (prefix !== undefined && prefix !== APP) return statement.text.replace(/\bapp(?=\s*\.openapi)/u, prefix)
    }
    return statement.text
  })

  // What is the user's: their imports, and what the generator does not write.
  const userImports = old.flatMap((statement) =>
    statement.node.type === 'ImportDeclaration'
      ? (userImport(statement.node, existing, imported, generatedSources) ?? [])
      : [],
  )
  const generatedTexts = new Set(fresh.map((statement) => statement.text))
  const userCode = old.filter(
    (statement) =>
      statement.node.type !== 'ImportDeclaration' &&
      // A statement the generated file has as it is (`export default app`, `export * from './books.js'`).
      !generatedTexts.has(statement.text) &&
      !statement.names.some((name) => generatedNames.has(name) || OWNED.test(name)),
  )

  const lastImport = fresh.findLastIndex((statement) => statement.node.type === 'ImportDeclaration')
  const imports = [...body.slice(0, lastImport + 1), ...userImports].join('\n')
  const parts = [
    imports,
    // The user's code before the generated statements, which may use it (a middleware of the app).
    ...userCode.map((statement) => statement.text),
    ...body.slice(lastImport + 1),
  ]
  // `export * from` lines (a barrel) one after another, as imports are; other statements apart.
  const kept = parts.filter((part) => part !== '')
  const joined = kept
    .map((part, index) => {
      const previous = kept[index - 1]
      if (previous === undefined) return part
      return `${isReexport(previous) && isReexport(part) ? '\n' : '\n\n'}${part}`
    })
    .join('')
  return `${joined}\n`
}

/** The handlers a file exports (`xxxRouteHandler`): where each is, so that it stays there. */
export function handlersIn(source: string, file: string): string[] {
  return statementsOf(source, file).flatMap((statement) => statement.names.filter(isHandler))
}
