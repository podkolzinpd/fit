import { readFile } from "node:fs/promises"
import {
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
} from "../supabase/functions/summarize-client-training/summary-contract.ts"
import {
  summaryQualityIssues,
} from "../supabase/functions/summarize-client-training/summary-quality.ts"

const envPath = new URL(
  process.argv[2] ?? "../supabase/functions/.env.local",
  import.meta.url,
)
const fixturePath = new URL(
  process.argv[3] ?? "./fixtures/yandex-progress-6m.json",
  import.meta.url,
)

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=")
        const key = line.slice(0, separator)
        const raw = line.slice(separator + 1)
        return [key, raw.replace(/^(['"])(.*)\1$/, "$2")]
      }),
  )
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function mask(value, secret) {
  return String(value)
    .replaceAll(secret, "[MASKED]")
    .replace(/(?:AQAD-|y[01]_|t[01]_)[A-Za-z0-9_-]+/g, "[MASKED]")
}

const localEnv = parseEnv(await readFile(envPath, "utf8"))
const apiKey = required(localEnv.YANDEX_CLOUD_API_KEY, "YANDEX_CLOUD_API_KEY")
const folderId = required(
  localEnv.YANDEX_CLOUD_FOLDER_ID,
  "YANDEX_CLOUD_FOLDER_ID",
)
const modelId = process.argv[4] || localEnv.YANDEX_CLOUD_MODEL_ID ||
  "yandexgpt"
const trainingData = JSON.parse(await readFile(fixturePath, "utf8"))
const modelUri = `gpt://${folderId}/${modelId}/latest`

const messages = [
  { role: "system", text: SUMMARY_SYSTEM_PROMPT },
  {
    role: "user",
    text: JSON.stringify({
      period: trainingData.period,
      completed_workouts: trainingData,
    }),
  },
]
const usage = {}
let finalResult

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const response = await fetch(
    "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
    {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      modelUri,
      completionOptions: {
        stream: false,
        temperature: 0.1,
        maxTokens: "1800",
      },
      jsonSchema: { schema: SUMMARY_JSON_SCHEMA },
      messages,
    }),
    },
  )

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(
      mask(`Yandex Cloud returned HTTP ${response.status}: ${body}`, apiKey),
    )
  }

  const payload = await response.json()
  const raw = payload.result?.alternatives?.[0]?.message?.text
  if (!raw) throw new Error("Yandex Cloud returned an empty completion")

  for (const [key, value] of Object.entries(payload.result?.usage ?? {})) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      usage[key] = String(Number(usage[key] ?? 0) + numeric)
    }
  }

  const summary = JSON.parse(raw)
  const issues = summaryQualityIssues(summary, trainingData)
  if (issues.length === 0) {
    finalResult = {
      model_uri: modelUri,
      model_version: payload.result?.modelVersion ?? null,
      attempts: attempt,
      usage,
      summary,
    }
    break
  }
  if (attempt === 3) {
    throw new Error(`Summary failed quality checks: ${issues.join("; ")}`)
  }

  messages.push(
    { role: "assistant", text: raw },
    {
      role: "user",
      text:
        "Предыдущий JSON не прошёл автоматическую проверку. Верни полный исправленный JSON. " +
        "Не меняй подтверждённые числа. Нарушения:\n- " +
        issues.join("\n- "),
    },
  )
}

console.log(JSON.stringify(finalResult, null, 2))
