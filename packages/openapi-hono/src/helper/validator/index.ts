import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Context, Env } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { validator } from 'hono/validator'

import type { Hook, RuntimeRoute, Target } from '../../types/validation.js'
import { entriesOf, isObject } from '../../utils/object.js'
import { isStandard, validatorOf } from '../../utils/schema.js'
import type { StandardIssue, Validate } from '../../utils/schema.js'

const JSON_TYPE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json$/iu
const FORM_TYPE = /^(?:multipart\/form-data|application\/x-www-form-urlencoded)$/iu

const mediaTypeOf = (headers: { get: (name: string) => string | null | undefined }) =>
  headers.get('content-type')?.split(';')[0]?.trim() ?? ''

/** The schema of the first media type of `content` that matches `pattern`, if any. */
const schemaFor = (content: Readonly<Record<string, { readonly schema?: unknown }>> | undefined, pattern: RegExp) => {
  const entry = Object.entries(content ?? {}).find(([type]) => pattern.test(type))
  return entry === undefined ? undefined : { schema: entry[1].schema }
}

/** The `next` of a check: the handler is run after the checks, not by them. */
const CHECKED = () => Promise.resolve()

const isStandardSchema = (value: unknown): value is StandardSchemaV1 => validatorOf(value) !== undefined

type Check = (c: Context<Env, string>, next: () => Promise<void>) => unknown

/** The check of a part: `sValidator()`, or for `schema<T>()` (a type, no check) the value handed on. */
const checkOf = (target: Target, schema: unknown, hook: Hook | undefined): Check =>
  isStandardSchema(schema) ? sValidator(target, schema, hook) : validator(target, (value: unknown) => value)

function partChecksOf(route: RuntimeRoute, hook: Hook | undefined): Check[] {
  const { params, query, headers, cookies } = route.request ?? {}
  return [
    ...(params === undefined ? [] : [checkOf('param', params, hook)]),
    ...(query === undefined ? [] : [checkOf('query', query, hook)]),
    ...(headers === undefined ? [] : [checkOf('header', headers, hook)]),
    ...(cookies === undefined ? [] : [checkOf('cookie', cookies, hook)]),
  ]
}

/**
 * The check of the body: JSON or a form, by its media type when the route declares both. An
 * optional body that was not sent is not checked.
 */
function bodyCheckOf(route: RuntimeRoute, hook: Hook | undefined): Check | undefined {
  const body = route.request?.body
  if (body === undefined) return undefined
  const jsonSchema = schemaFor(body.content, JSON_TYPE)
  const formSchema = schemaFor(body.content, FORM_TYPE)
  const json = jsonSchema === undefined ? undefined : checkOf('json', jsonSchema.schema, hook)
  const form = formSchema === undefined ? undefined : checkOf('form', formSchema.schema, hook)
  const optional = body.required === false
  return async (c, next) => {
    if (optional && c.req.raw.body === null) return next()
    const check =
      json !== undefined && (form === undefined || !FORM_TYPE.test(mediaTypeOf(c.req.raw.headers))) ? json : form
    return check === undefined ? next() : check(c, next)
  }
}

/** The check of each status's JSON response, found by the status, its range (`2XX`), then `default`. */
function responseChecksOf(route: RuntimeRoute): ((status: number) => Validate | undefined) | undefined {
  const declared = new Map<string, Validate>()
  for (const [status, response] of Object.entries(route.responses)) {
    const validate = validatorOf(schemaFor(response?.content, JSON_TYPE)?.schema)
    if (validate !== undefined) declared.set(status, validate)
  }
  if (declared.size === 0) return undefined
  const byStatus = new Map<number, Validate | undefined>()
  return (status) => {
    if (byStatus.has(status)) return byStatus.get(status)
    const key = String(status)
    const validate = declared.get(key) ?? declared.get(`${key[0]}XX`) ?? declared.get('default')
    byStatus.set(status, validate)
    return validate
  }
}

const responseFailure = (c: Context, issues: readonly StandardIssue[]) =>
  new HTTPException(500, {
    res: c.json({ error: 'Response validation failed' }, 500),
    cause: { issues: [{ slot: 'response', issues }] },
  })

/** Checks a JSON response by reading it back, and answers the schema's output in its place. */
async function checkBody(res: Response, validate: Validate, c: Context): Promise<Response> {
  const text = await res.clone().text()
  const result = await validate(text === '' ? undefined : JSON.parse(text))
  if (result.issues) throw responseFailure(c, result.issues)
  return new Response(JSON.stringify(result.value), res)
}

type Json = (object: unknown, arg?: unknown, headers?: unknown) => Response

/**
 * Every schema slot of a route, with where it is.
 *
 * @yields `[where, schema]`: `params`, ..., `body application/json`, `200 application/json`, ...
 */
function* slotsOf(route: RuntimeRoute): Generator<[string, unknown]> {
  const { params, query, headers, cookies, body } = route.request ?? {}
  yield* [
    ['params', params],
    ['query', query],
    ['headers', headers],
    ['cookies', cookies],
  ] as const
  for (const [type, media] of entriesOf(body?.content)) {
    yield [`body ${type}`, isObject(media) ? media.schema : undefined]
  }
  for (const [status, response] of entriesOf(route.responses)) {
    const content = isObject(response) ? response.content : undefined
    for (const [type, media] of entriesOf(content)) {
      yield [`${status} ${type}`, isObject(media) ? media.schema : undefined]
    }
  }
}

/**
 * Throws for a Standard Schema that cannot check: one that has only `~standard.jsonSchema`
 * (Effect's `toStandardJSONSchemaV1` alone) would let every value through without a word.
 */
function assertCheckable(route: RuntimeRoute): void {
  for (const [where, schema] of slotsOf(route)) {
    if (isObject(schema) && !isStandard(schema) && '~effect/Schema/Schema' in schema) {
      throw new TypeError(
        `${route.method.toUpperCase()} ${route.path} ${where}: an Effect schema is not a Standard Schema as it is. ` +
          `Declare the route with createRoute() from 'openapi-hono/effect', which makes it one.`,
      )
    }
    if (isStandard(schema) && validatorOf(schema) === undefined) {
      throw new TypeError(
        `${route.method.toUpperCase()} ${route.path} ${where}: the schema has no ~standard.validate, so it cannot ` +
          `check. Effect's needs Schema.toStandardSchemaV1() (and toStandardJSONSchemaV1() for the document).`,
      )
    }
  }
}

/**
 * A response made by `c.json(value, status)` is checked as it is made, and is not read back. Any
 * other JSON response (`c.json(value)` after `c.status()`, an asynchronous schema) is read back.
 */
function checkedResponse(
  handler: (c: Context, next: () => Promise<void>) => unknown,
  responseCheck: (status: number) => Validate | undefined,
) {
  return async (c: Context<Env, string>, next: () => Promise<void>): Promise<unknown> => {
    let checked: Response | undefined = undefined
    // `c.json` is overloaded and generic in Hono's types; it is wrapped here as the plain function it is.
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
    const json = c.json as unknown as Json
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
    ;(c as unknown as { json: Json }).json = (object, arg, headers) => {
      const validate = typeof arg === 'number' ? responseCheck(arg) : undefined
      if (validate === undefined) return json.call(c, object, arg, headers)
      const result = validate(object)
      if (result instanceof Promise) return json.call(c, object, arg, headers)
      if (result.issues) throw responseFailure(c, result.issues)
      return (checked = json.call(c, result.value, arg, headers))
    }
    let res = handler(c, next)
    if (res instanceof Promise) res = await res
    if (!(res instanceof Response) || res === checked || !JSON_TYPE.test(mediaTypeOf(res.headers))) return res
    const validate = responseCheck(res.status)
    return validate === undefined ? res : checkBody(res, validate, c)
  }
}

/** The route's handler with its checks around it: the request's parts before it, its JSON response after it. */
export function withValidation(
  route: RuntimeRoute,
  handler: (c: Context, next: () => Promise<void>) => unknown,
  hook: Hook | undefined,
  responses: boolean,
): (c: Context<Env, string>, next: () => Promise<void>) => unknown {
  assertCheckable(route)
  const bodyCheck = bodyCheckOf(route, hook)
  const checks = [...partChecksOf(route, hook), ...(bodyCheck === undefined ? [] : [bodyCheck])]
  const responseCheck = responses ? responseChecksOf(route) : undefined
  // A new function even with nothing to check: the document finds the route by it, so that one
  // handler may serve two routes.
  const respond =
    responseCheck === undefined
      ? (c: Context<Env, string>, next: () => Promise<void>) => handler(c, next)
      : checkedResponse(handler, responseCheck)
  if (checks.length === 0) return respond
  // Each check is handed a `next` that does nothing, so that the handler runs after them, not
  // inside them: nothing is made per request.
  return async (c, next) => {
    for (const check of checks) {
      // oxlint-disable-next-line no-await-in-loop -- one part after another, as sValidator()s are run
      const res = await check(c, CHECKED)
      if (res instanceof Response) return res
    }
    return respond(c, next)
  }
}
