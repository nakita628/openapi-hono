/** openapi-hono/client: Hono's RPC client, called by operationId. */

export { createClient } from './helper/client/index.js'
export type { Client, Operation, OperationOutput, RequestOf, ResponseOf, RoutesOf } from './types/client.js'
export { DetailedError, parseResponse } from 'hono/client'
