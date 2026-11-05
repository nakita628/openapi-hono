/**
 * The type check of generated files: the handlers are generated empty (`async (c) => {}`, yours to
 * write), and an empty handler is a type error until it answers. Every other line type-checks.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = import.meta.dirname

/** The lines tsc reports an error at, besides the empty handlers. */
export function typeErrorsBesidesEmptyHandlers(tsconfig: string): string[] {
  // tsc writes the files relative to where it runs: the package.
  const cwd = join(here, '..')
  const tsc = join(cwd, 'node_modules', '.bin', 'tsc')
  let output = ''
  try {
    execFileSync(tsc, ['-p', join(here, tsconfig)], { stdio: 'pipe', cwd })
  } catch (error) {
    // tsc fails with the errors on its stdout.
    output = String(error instanceof Error && 'stdout' in error ? error.stdout : error)
  }
  return output.split('\n').flatMap((line) => {
    const match = /^(.+?)\((\d+),\d+\): error /u.exec(line)
    if (match === null) return []
    const [, file = '', at = '0'] = match
    // The declaration from that line on, its spaces gone: an empty handler the formatter has wrapped
    // (`async (\n  c,\n) => {}`) is one too.
    const lines = readFileSync(resolve(cwd, file), 'utf8').split('\n')
    const declaration = lines
      .slice(Number(at) - 1, Number(at) + 2)
      .join('')
      .replaceAll(/\s/gu, '')
      .replaceAll(',)', ')')
    return declaration.includes('=async(c)=>{}') ? [] : [line]
  })
}
