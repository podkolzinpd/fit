import { isDeepStrictEqual } from 'node:util'

// API Gateway expands these OpenAPI defaults on readback. Normalize only
// inline string path parameters used by this frontend, not arbitrary fields.
function normalizeRoute(route) {
  const result = structuredClone(route)
  for (const owner of [result, result?.get, result?.head]) {
    for (const parameter of owner?.parameters ?? []) {
      if (parameter.$ref || parameter.in !== 'path' || parameter.schema?.type !== 'string') continue
      if (!Object.hasOwn(parameter, 'style')) parameter.style = 'simple'
      if (parameter.style === 'simple' && !Object.hasOwn(parameter, 'explode')) parameter.explode = false
    }
  }
  return result
}

export function gatewayRoutesEqual(left, right) {
  return isDeepStrictEqual(normalizeRoute(left), normalizeRoute(right))
}

export function gatewaySpecificationsEqual(left, right) {
  const normalize = (spec) => {
    const result = structuredClone(spec)
    for (const [path, route] of Object.entries(result?.paths ?? {})) result.paths[path] = normalizeRoute(route)
    return result
  }
  return isDeepStrictEqual(normalize(left), normalize(right))
}
