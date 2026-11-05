/** The path template of a Hono path: `/api/users/:id` is `/api/users/{id}`. */
export const templateOf = (path: string) => path.replaceAll(/:([^/{}]+)/gu, '{$1}')

export const honoPathOf = (template: string) => template.replaceAll(/\{([^}]+)\}/gu, ':$1')
