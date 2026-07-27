# summarize-client-training

Authenticated trainer/client Edge Function that analyzes a client's progress
across completed training sessions for a requested period. One model request
returns structured `trainer` and `client` copies. A linked client can request
the analysis directly; only the safe `client` copy is then written to the
client-visible table.

Request:

```json
{
  "client_id": "00000000-0000-4000-8000-000000000000",
  "period_start": "2026-07-01",
  "period_end": "2026-07-31",
  "force": false
}
```

When `force` is omitted or false, the function returns the stored summary
without another model request if the aggregated input fingerprint is unchanged.
Use `force: true` only for an explicit trainer refresh.

Required hosted secrets:

- `YANDEX_CLOUD_API_KEY`: service-account API key limited to
  `yc.ai.languageModels.execute`.
- `YANDEX_CLOUD_FOLDER_ID`: folder where the model is available.
- `YANDEX_CLOUD_MODEL_ID`: optional, defaults to `yandexgpt` (Pro).

Set them in Supabase Dashboard under Edge Functions → Secrets or with:

```sh
npx supabase secrets set --env-file ./supabase/functions/.env.local
```

Never commit `supabase/functions/.env.local`. The function sends only completed
workout frequency plus aggregated exercise metrics: first/last result, volume,
pace, best result and a compact session series. Client names, contacts, trainer
notes, private details, and body measurements are not included.

The Yandex Text Generation request uses `jsonSchema` and prompt version
`training-progress-v4`. Generated rows are never client-readable directly.
Publication copies only `client_summary` and deterministic display metrics into
`client_published_training_summaries`.

Every YandexGPT Pro candidate is checked for audience separation, neutral
client language, exercise coverage, regularity wording, and unsupported health
assumptions. A failed candidate is sent back to the model for correction up to
two times and is never stored if it still fails.

Run a live anonymized smoke test with the same prompt and quality gate:

```sh
npm run ai:smoke
```
