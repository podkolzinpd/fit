# Trainer slide · Fit Lime · 2026-10-04

Actual Fit application routes rendered locally from app revision `a6d1307b`;
no application source or production data was changed. Application accent is
`--lime-accent: #b6ef4d`, from `src/styles/fit-lime-components.css`.

- `clients.png`: `/clients`, three fictitious filled client profiles.
- `create.png`: actual quick-plan dialog, entered via Today → New workout →
  Plan. Fictional client Alexey Smirnov, strength training at 12:00. The dialog
  was captured directly, not redrawn or generated.
- `progress-map.png`: actual `.body-progress-map` on `/progress/:clientId`.
  Synthetic training history and summary responses are supplied only in an
  isolated browser fixture. Values are demonstrations, not business metrics
  or real user outcomes. The displayed progress figure and overlay belong to
  the application; no recoloring was applied to the PNGs.

Capture: mobile 430 px, device scale 2, Russian locale, fixed 2026-10-04 clock.
All remote requests are blocked. Local API responses are mocked from the app's
existing `trainer-schedule-v2.visual.spec.ts` fixture contracts. Tall viewport
for the progress fragment keeps fixed navigation out of the screenshot.

Scope: logical slide 04 only. Original deck entry point/assets stay unchanged.
Preserved composition: one dominant screen and a fixed three-step context rail.
Fit skill golden `linear/03-linear-product-flow.png` supplies only grouping and
reading order, not colors or UI. Changes beyond actual screenshots: restrained
boundary, app-lime selection outline and route indicator. No new capabilities.

Existing `motion-key-transitions.mp4` documents iteration 2, before this color
refresh; it is not the current slide preview.

QA: all three motion states and static overview inspected at 1920×1080.
The other 14 slides match baseline `2c90a56` pixel-for-pixel after controls are
hidden and images decoded. Full 28-state regression passes, including keyboard,
stationary thumbnails, reduced motion, fullscreen and print. Screenshot crop
overflow reported by the generic checker is intentional; no broken images.
