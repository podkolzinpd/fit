# Assistant workout card — Product Design QA

## Target and adaptation

- Source: `/Users/a-goltsov/.codex/generated_images/01a038b4-06ef-70e0-8499-41d823e9f2a6/exec-d2dd26b5-6d1f-41df-9cc8-9c1ac24e8188.png`.
- The source shows a dedicated workout editor. The implemented target is its in-chat mobile adaptation requested by the product owner: the same structured rows, date/time, editable metrics, low-confidence choices and final confirmation live in the active context card instead of navigating away.

## Verified implementation

- Production surface: `src/features/assistant/AssistantWorkoutDraftSurface.tsx`.
- The capture used the exported production surface rendered by the assistant flow, not a hand-written DOM copy. The temporary capture route was removed after QA.
- WebKit 26.5, iPhone 13 profile, 390 × 844 CSS px: `/private/tmp/fit-assistant-workout-actual-3.png`.
- Side-by-side source and implementation input: `/private/tmp/fit-assistant-comparison.png`.

## Findings

- Resolved: the previous implementation showed a raw transcript and an intermediate parsing CTA instead of the designed structured editor.
- Resolved: date and local fill time are visible and editable in the card.
- Resolved: every cumulative dictation tail appends a new structured exercise without replacing earlier rows.
- Resolved: sets, reps and weight are editable in place; rows can be removed.
- Resolved: an ambiguous `жим лёжа` keeps its parsed metrics while asking the trainer to choose barbell or dumbbells.
- Resolved: the full two-exercise ambiguity state fits the 390 × 844 WebKit viewport without horizontal overflow; the final action remains visible.
- Intentional mobile-chat adaptation: drag handles and a separate manual-add row from the full-page source are omitted because ordering is append-only in chat and the persistent chat composer is the add control.

No open P0, P1 or P2 visual or interaction findings.

final result: passed
