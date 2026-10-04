# Client AI program · review 6.3 · 2026-10-04

Scope: first client scenario only. Added immediately after the unchanged client
slide 6.1 in `greatfinal-motion-v2`. The mobile 6.3 replaces the wide 6.2;
no comparison duplicate remains, as requested. No changes to the old published branch.

Three presenter-controlled states: request/confirmed conditions → draft program
for review → workout after confirmation and adding to schedule. Example numbers
and program are fictional illustration, not an API recording or exercise advice.
Product pilot availability and illustration status are retained in speaker notes.

UI sources inspected in `worktrees/fit-lime-direct-release-20261004`:
- `src/styles/fit-lime-components.css`: surfaces, lime #b6ef4d, radii and buttons.
- `src/styles/fit-lime-assistant.css`: user bubble, context and primary action.
- `src/features/assistant/AssistantProgramOverview.tsx`: days, dosage and history.
- `e2e/assistant-program-pilot.webkit.spec.ts`: client mode, confirmation,
  1–4-week programs, history and saving to schedule.

Presentation adapts the source UI for legibility; it is not a literal app capture.
Exercise files are exact copies from `public/exercises/vital/` in that source:
`leg-press-machine.mp4`, `leg-press-machine.jpg`, `romanian-deadlift.jpg`,
`pec-deck.jpg`. No generated anatomy or altered exercise motion.

Primary composition reference: `linear/03-linear-product-flow.png`, used only for
dominant UI scale and sequential hierarchy. Fit's approved black/lime identity
and real component forms take precedence. Static/reduced-motion use the original
exercise still, and the video pauses when leaving the slide.
