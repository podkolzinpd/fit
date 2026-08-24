# Assistant sandbox: local first slice

## Scope

`/assistant` is a trainer-only local prototype of the future assistant. The
top navigation exposes it only through the existing default-off assistant
allowlist. The route itself deliberately uses no query, repository, Edge
Function, Yandex Cloud API, database migration, analytics event or persisted
state.

The screen is based on the Figma assistant patterns: a user message, an
assistant status, editable workout-set cards and a single summary card. All
values are component state and the save button only marks the local draft as
saved. Scenario selection is intentionally not rendered in the product UI:
the future orchestrator derives it from the text or SpeechKit transcript.

The trainer enters it from the existing bottom tab bar on the non-immersive
start screen (`Сегодня → Клиенты → Ассистент → Расписание`). A client in the
same local allowlist gets the same tab between `Прогресс` and `Профиль`. There
is no close button: the same tabs or the platform back gesture return to the
previous task.

## Why the renderer comes before AI

The future model must propose a typed action, never write directly to a
database or produce UI markup. The same card renderer will first receive local
mock data, then a validated Yandex Cloud API DTO.

```text
text or SpeechKit transcript
  -> orchestrator proposes { action, payload }
  -> client validates and renders an editable card
  -> explicit confirmation
  -> domain API command with actor scope and optimistic version
```

The first expected actions are `start_live_workout`, `record_set`, `update_set`,
`add_set`, `finish_workout`, `create_client_draft`, `create_program_draft`,
`schedule_program` and `summarize_progress`.

## Existing progress summary as an assistant tool

`summarize_progress` is a wrapper around the existing
`summarize-client-training` capability, not a second LLM summary. Its stage
adapter will pass the same `client_id`, period and explicit `force` flag, then
render only the authorized trainer/client copy from its result. The assistant
may use the result as context for a proposed program, but must not reinterpret
it as medical advice or turn it into a write without a separate confirmed
action.

The local sandbox uses an inert preview of this tool: it makes no Edge Function
request and holds no real client ID. This preserves the local-only boundary
while exercising the same action and confirmation path.

## Rollout boundary

No YandexGPT, SpeechKit invocation, Cloud resource, database write or
production routing is introduced by this slice. Voice remains visually
represented but disabled until the transcript flow is explicitly connected in
a later local/stage slice.

Before any stage action, add: typed tool contracts, role/tenant checks,
operation IDs, confirmation UI, retry/error states and an audit record that
contains no raw credentials or unnecessary health information. The local UI
already exercises `needs_input → proposed → confirmed/cancelled`; `confirmed`
is not an execution signal until a server-side command is introduced.

## Target Cloud boundary

The next backend slice is a bounded assistant endpoint in Yandex Cloud, not an
autonomous agent. It accepts a text message or a SpeechKit transcript and the
minimum actor-scoped context. Its only output is one validated action proposal
from the union in `assistant-contract.ts`. It has no database credentials that
can bypass the normal domain API.

```text
SpeechKit or text -> assistant orchestrator -> typed proposal
                                           -> confirmation token
                                           -> ordinary domain API command
                                           -> audited result
```

The API owns authorization, tenant scope, idempotency and validation. The
orchestrator may ask the next safe question or assemble a draft, but it cannot
create a client, write a workout, generate a schedule or call a medical tool on
its own. A program proposal is additionally checked for required intake data
(goal, experience, limitations and available days) before it can be confirmed.

The first vertical endpoint is `POST /v1/assistant/progress-summary`. It has a
fixed `client_id`, period and optional `force` request contract and delegates
only to the existing summary capability. It accepts the actor JWT in the
existing `x-supabase-authorization` boundary, validates before calling the
tool, and deliberately exposes no write action or generic arbitrary-tool API.
The frontend transport is inert unless the already isolated
`VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL` points to an explicit local or
stage API. The sandbox itself does not invoke that transport.
