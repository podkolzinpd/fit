export function parseYandexJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("yandex_cloud_invalid_json")
  }
}
