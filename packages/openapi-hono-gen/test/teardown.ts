/** Removes what the tests write (test/generated) once they have run. */

import { rmSync } from 'node:fs'
import { join } from 'node:path'

export function teardown(): void {
  rmSync(join(import.meta.dirname, 'generated'), { recursive: true, force: true })
}
