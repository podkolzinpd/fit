import { describe, expect, it } from "vitest"
import { parseYandexJson } from "../../services/api/src/legacy-summary/self-service"

describe("Yandex summary JSON decoding", () => {
  it("decodes valid JSON and classifies invalid JSON", () => {
    expect(() => parseYandexJson("{not-json")).toThrow("yandex_cloud_invalid_json")
    expect(parseYandexJson<{ ok: boolean }>(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })
})
