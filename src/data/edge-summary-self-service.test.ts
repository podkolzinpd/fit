import { describe, expect, it } from "vitest"
import {
  authorizeSummaryActor,
  clientVisibleSummary,
  hasCompletedWorkouts,
  parseYandexJson,
  shouldUseClientCache,
  yandexHttpError,
} from "../../supabase/functions/summarize-client-training/self-service"

const client = {
  id: "client-1",
  trainer_id: "trainer-1",
  auth_user_id: "user-1",
}

describe("summarize-client-training self-service contract", () => {
  it("allows a client to request only their own client_id", () => {
    expect(authorizeSummaryActor("user-1", client)).toEqual({
      isTrainer: false,
      isClient: true,
      isConnectedTrainer: false,
      trainerId: "trainer-1",
    })
    expect(authorizeSummaryActor("user-1", {
      ...client,
      id: "client-2",
      auth_user_id: "other-user",
    })).toBeNull()
  })

  it("denies another client's request", () => {
    expect(authorizeSummaryActor("other-user", client)).toBeNull()
    expect(authorizeSummaryActor("user-1", null)).toBeNull()
  })

  it("allows only a trainer connected to this client", () => {
    expect(authorizeSummaryActor("trainer-2", client, ["trainer-2"])).toEqual({
      isTrainer: true,
      isClient: false,
      isConnectedTrainer: true,
      trainerId: "trainer-1",
    })
    expect(authorizeSummaryActor("trainer-3", client, ["trainer-2"])).toBeNull()
  })

  it("never exposes trainer_summary in the client response", () => {
    const visible = clientVisibleSummary({
      id: "summary-1",
      summary: { headline: "Рост" },
      trainer_summary: { headline: "Служебная версия" },
      input_fingerprint: "private",
      token_usage: { input: "1" },
      generated_at: "2026-07-27T00:00:00Z",
    })
    expect(visible).toEqual({
      id: "summary-1",
      summary: { headline: "Рост" },
      generated_at: "2026-07-27T00:00:00Z",
    })
    expect(visible).not.toHaveProperty("trainer_summary")
  })

  it("uses cache by default and bypasses it with force", () => {
    expect(shouldUseClientCache(false, { id: "cached" })).toBe(true)
    expect(shouldUseClientCache(true, { id: "cached" })).toBe(false)
    expect(shouldUseClientCache(false, null)).toBe(false)
  })

  it("returns no-completed-workouts condition for an empty source", () => {
    expect(hasCompletedWorkouts([])).toBe(false)
    expect(hasCompletedWorkouts([{ id: "workout-1" }])).toBe(true)
  })

  it("classifies Yandex HTTP failures, timeouts and invalid JSON", () => {
    expect(yandexHttpError(503, "upstream timeout")).toBe(
      "yandex_cloud_error_503:upstream timeout",
    )
    expect(yandexHttpError(504, "")).toBe("yandex_cloud_error_504")
    expect(() => parseYandexJson("{not-json")).toThrow("yandex_cloud_invalid_json")
    expect(parseYandexJson<{ ok: boolean }>(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })
})
