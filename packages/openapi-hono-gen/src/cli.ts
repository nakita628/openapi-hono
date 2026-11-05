/** The command: reads the config and its document (OpenAPI or TypeSpec), and writes the files. */

import { dirname, posix, resolve } from 'node:path'

import { Console, Effect, FileSystem, Option, Schema } from 'effect'
import { CliError, Command, Flag } from 'effect/cli'
import { parseOpenAPI } from 'oas-truth'

import { DEFAULT_CONFIG_FILE, readConfig } from './config.js'
import { generate, pathsOf } from './generate.js'

const COMMAND_NAME = 'openapi-hono-gen'

const VERSION = '0.0.1'

// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError()` is the class factory, not a throw
export class InputError extends Schema.TaggedError<InputError>()('InputError', {
  message: Schema.String,
}) {}

const commandLine = {
  config: Flag.String('config').pipe(
    Flag.withAlias('c'),
    Flag.withDescription(`Config file to run (default: ./${DEFAULT_CONFIG_FILE})`),
    Flag.withMetavar('file'),
    Flag.optional,
  ),
} as const

const at = (file: string) => resolve(process.cwd(), file)

export function run(configPath: string) {
  return Effect.gen(function* () {
    const config = yield* readConfig(configPath)
    const parsed = yield* Effect.promise(() => parseOpenAPI(config.input))
    if (!parsed.ok) return yield* new InputError({ message: `${config.input}: ${parsed.error}` })
    const fs = yield* FileSystem.FileSystem
    // What is there already: the app entry and the handlers, which the new files are merged into.
    const paths = pathsOf(config)
    const handlerFiles = (yield* fs.exists(at(paths.handlers)))
      ? (yield* fs.readDirectory(at(paths.handlers)))
          .filter((name) => name.endsWith('.ts'))
          .map((name) => posix.join(paths.handlers, name))
      : []
    const existing = new Map<string, string>()
    for (const file of [paths.index, ...handlerFiles]) {
      if (yield* fs.exists(at(file))) existing.set(file, yield* fs.readFileString(at(file)))
    }
    const files = yield* generate(parsed.value, config, existing)
    for (const [file, code] of files) {
      yield* fs.makeDirectory(dirname(at(file)), { recursive: true })
      yield* fs.writeFileString(at(file), code)
    }
    return `🔥 Generated from ${config.input}:\n${[...files.keys()].map((file) => `  ${file}`).join('\n')}`
  })
}

function main(args: Command.Command.Config.Infer<typeof commandLine>) {
  return run(Option.getOrElse(args.config, () => DEFAULT_CONFIG_FILE)).pipe(
    Effect.flatMap((report) => Console.log(report)),
    Effect.mapError((error) =>
      CliError.isCliError(error) ? error : new CliError.UserError({ cause: error, userMessage: error.message }),
    ),
  )
}

export function openapiHonoGen() {
  const cli = Command.make(COMMAND_NAME, commandLine, main).pipe(
    Command.withDescription('Generate openapi-hono routes, handlers, the app and its client'),
  )
  return Command.run(cli, { version: VERSION })
}
