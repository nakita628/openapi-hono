/** An object, or a function (ArkType's types and Effect's schemas are callable). */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null

export const entriesOf = (value: unknown): [string, unknown][] => Object.entries(isObject(value) ? value : {})
