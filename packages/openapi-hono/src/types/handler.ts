import type { Env, Handler, MergePath, ResponseFormat, TypedResponse } from 'hono/types'
import type {
  ClientErrorStatusCode,
  InfoStatusCode,
  RedirectStatusCode,
  ServerErrorStatusCode,
  StatusCode,
  SuccessStatusCode,
} from 'hono/utils/http-status'

import type { InferInput, InferOutput, RouteConfig } from './route.js'

/** The Hono path of a path template: `/users/{id}` is `/users/:id`. */
export type HonoPath<P extends string> = P extends `${infer Head}{${infer Name}}${infer Tail}`
  ? `${Head}:${Name}${HonoPath<Tail>}`
  : P

type TemplateKeys<P extends string> = P extends `${string}{${infer Name}}${infer Tail}`
  ? Name | TemplateKeys<Tail>
  : never

// oxlint-disable-next-line typescript/no-empty-object-type -- `{}` is the type meant here, as Hono's own `BlankInput` is
type Blank = {}

type RequestOf<R> = R extends { readonly request: infer Q } ? Q : Blank

/** The JSON body's schema, `application/json` read first. */
type JsonSchemaOf<B> = B extends { readonly content: { readonly 'application/json': { readonly schema: infer S } } }
  ? S
  : never

type FormSchemaOf<B> = B extends {
  readonly content: { readonly 'multipart/form-data': { readonly schema: infer S } }
}
  ? S
  : B extends { readonly content: { readonly 'application/x-www-form-urlencoded': { readonly schema: infer S } } }
    ? S
    : never

/** Each part's schema, by Hono's name: read only for the names the request has. */
type SchemasOf<Q> = {
  param: Q[Extract<'params', keyof Q>]
  query: Q[Extract<'query', keyof Q>]
  header: Q[Extract<'headers', keyof Q>]
  cookie: Q[Extract<'cookies', keyof Q>]
  json: JsonSchemaOf<Q[Extract<'body', keyof Q>]>
  form: FormSchemaOf<Q[Extract<'body', keyof Q>]>
}

/** Hono's names of the parts a request declares: `params` is `param`, a JSON body `json`. */
type TargetsOf<Q> = keyof Q extends infer K
  ? K extends 'params'
    ? 'param'
    : K extends 'query'
      ? 'query'
      : K extends 'headers'
        ? 'header'
        : K extends 'cookies'
          ? 'cookie'
          : K extends 'body'
            ?
                | ([JsonSchemaOf<Q[K & keyof Q]>] extends [never] ? never : 'json')
                | ([FormSchemaOf<Q[K & keyof Q]>] extends [never] ? never : 'form')
            : never
  : never

/** The parts as the client sends them: each schema's input. One mapped type, no intersection. */
type InSides<Q> = { [T in TargetsOf<Q>]: InferInput<SchemasOf<Q>[T]> }

/** The parts as `c.req.valid()` gives them: each schema's output. */
type OutSides<Q> = { [T in TargetsOf<Q>]: InferOutput<SchemasOf<Q>[T]> }

type Sides<Q, Out extends boolean> = Out extends true ? OutSides<Q> : InSides<Q>

/** Hono's `Input` of a route: what the client sends (`in`), what `c.req.valid()` gives (`out`). */
export type InputOf<R> = { in: Sides<RequestOf<R>, false>; out: Sides<RequestOf<R>, true> }

/** The statuses of a key of `responses`: `200`, `'404'`, `'2XX'`, `'default'`. */
export type StatusOf<K> = K extends StatusCode
  ? K
  : K extends `${infer N extends StatusCode}`
    ? N
    : K extends '1XX'
      ? InfoStatusCode
      : K extends '2XX'
        ? SuccessStatusCode
        : K extends '3XX'
          ? RedirectStatusCode
          : K extends '4XX'
            ? ClientErrorStatusCode
            : K extends '5XX'
              ? ServerErrorStatusCode
              : StatusCode

/** The body of a response as the handler hands it to `c.json()`, and as the client reads it. */
type JsonBodyOf<Res> = Res extends {
  readonly content: { readonly 'application/json': { readonly schema: infer S } }
}
  ? InferInput<S>
  : never

/** One declared response: JSON with the declared body, or any other with the declared status. */
type ResponseAt<K, Res> = [JsonBodyOf<Res>] extends [never]
  ? Response & TypedResponse<unknown, StatusOf<K>, ResponseFormat>
  : Response & TypedResponse<JsonBodyOf<Res>, StatusOf<K>, 'json'>

/** What the handler of `R` may answer with. */
export type RouteResponse<R extends RouteConfig> = {
  [K in keyof R['responses']]-?: ResponseAt<K, R['responses'][K]>
}[keyof R['responses']]

/** The handler of an operation, declared apart from `app.openapi()`. */
// oxlint-disable-next-line typescript/no-explicit-any -- Hono's own `Handler` defaults `E` to `any`, so that a handler fits any app
export type RouteHandler<R extends RouteConfig, E extends Env = any> = Handler<
  E,
  HonoPath<R['path']>,
  InputOf<R>,
  RouteResponse<R> | Promise<RouteResponse<R>>
>

/** What `hc` reads off an operation: one endpoint per declared response. */
export type EndpointOf<R extends RouteConfig> = {
  [K in keyof R['responses']]-?: {
    input: Optional<ClientInput<R>>
    output: [JsonBodyOf<R['responses'][K]>] extends [never] ? Blank : JsonBodyOf<R['responses'][K]>
    outputFormat: [JsonBodyOf<R['responses'][K]>] extends [never] ? string : 'json'
    status: StatusOf<K>
  }
}[keyof R['responses']]

/** The parts a client sends, a part that takes `{}` optional (a query of optional keys, say). */
type Optional<I> = Flat<
  { -readonly [K in keyof I as Blank extends I[K] ? K : never]?: I[K] } & {
    -readonly [K in keyof I as Blank extends I[K] ? never : K]: I[K]
  }
>

type Flat<T> = { [K in keyof T]: T[K] }

/** The client's side of the parts, with the template's parameters when no schema types them. */
export type ClientInput<R extends RouteConfig> = Sides<RequestOf<R>, false> &
  (RequestOf<R> extends { readonly params: unknown }
    ? Blank
    : [TemplateKeys<R['path']>] extends [never]
      ? Blank
      : { param: { [K in TemplateKeys<R['path']>]: string } })

/** Hono's schema of the routes, grouped by path: worked out when `hc` reads it, not when the app is built. */
export type SchemaOf<Routes extends RouteConfig, BasePath extends string> = {
  [P in Routes['path'] as MergePath<BasePath, HonoPath<P>>]: {
    [R in Extract<Routes, { readonly path: P }> as `$${R['method']}`]: EndpointOf<R>
  }
}
