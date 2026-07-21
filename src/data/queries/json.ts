import type { Json } from '../database.types'

export function toJson(value: object): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
