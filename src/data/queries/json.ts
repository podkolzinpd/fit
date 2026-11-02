export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export function toJson(value: object): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
