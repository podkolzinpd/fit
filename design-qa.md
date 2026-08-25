# Assistant mobile design QA

## Target

- Product Design workout and progress direction: `/Users/a-goltsov/.codex/generated_images/01a038b4-06ef-70e0-8499-41d823e9f2a6/exec-d2dd26b5-6d1f-41df-9cc8-9c1ac24e8188.png`
- Product Design client voice extraction direction: `/Users/a-goltsov/.codex/generated_images/01a038b4-06ef-70e0-8499-41d823e9f2a6/exec-266c6b6f-a7ae-4e2d-942a-779f3cc126d4.png`
- Product Design program direction: `/Users/a-goltsov/.codex/generated_images/01a038b4-06ef-70e0-8499-41d823e9f2a6/exec-a25c1161-ef91-41df-ab2f-11c3a7cf1ace.png`

## Implementation captures

WebKit 26.5, light theme, 390 px wide:

- workout collection: `/private/tmp/fit-assistant-workout.png` at 390 × 844
- parsed workout with exercise choice: `/private/tmp/fit-assistant-parsed.png` at 390 × 844
- extracted client draft: `/private/tmp/fit-assistant-client.png` at 390 × 844
- compact program draft: `/private/tmp/fit-assistant-program.png` at 390 × 844
- open keyboard state: `/private/tmp/fit-assistant-keyboard.png` at 390 × 508

The capture harness used the production component DOM classes and `src/styles.css`; it was removed after capture.

## Findings history

1. Initial implementation still rendered generic action previews, a promotional workout card, and a fully expanded program form. The iOS keyboard left the full-height assistant grid active.
2. First WebKit pass confirmed the new structured cards and fixed keyboard layout, but found that the sticky composer covered long workout output and the first program session opened as a wall of fields.
3. Final pass uses a non-overlay composer, collapsed program sessions, structured workout rows, inline ambiguity choices, compact client fields, and a dedicated keyboard layout. No horizontal overflow or clipped controls were observed in the captured states.

final result: passed
