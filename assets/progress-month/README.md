# Progress demo — 4 October 2026

Owner-approved **fictional** monthly workout history, not platform analytics.
All workout weights are maximum recorded squat weights, not tonnage or a claim
about percentage strength growth. The load map highlights quadriceps for the
three sets in the last workout, not physical muscle growth.

## Existing application assets

- `body.png`: `public/illustrations/body-progress-athlete.png`; front view and
  quadriceps paths from `src/features/progress/body-progress-photo-geometry.ts`.
- `workouts-10.webp`: `achievement-workouts-10-number-v2-20261001.webp`.
- `weeks-4.webp`: `achievement-regularity-4w-calendar-v1-20261001.webp`.
- `records-1.webp`: `achievement-distinct-pr-trophy-1-concept-20261001.webp`.
- Award names and criteria from `src/shared/athlete-achievements.ts`.

The demo was checked with the application's actual `computeAthleteAchievements`:
10 workouts earned on 04.10, four consecutive weeks on 21.09, first record on
11.09. No application files were changed.

Composition reference: whoop/11 (trend) and whoop/10 (metric hero). Only visual
hierarchy was borrowed; palette, phone styling and content stay Fit.
