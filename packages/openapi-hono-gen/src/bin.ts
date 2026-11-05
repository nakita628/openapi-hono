#!/usr/bin/env node
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect } from 'effect'

import { openapiHonoGen } from './cli.js'

NodeRuntime.runMain(openapiHonoGen().pipe(Effect.provide(NodeServices.layer)))
