# Fit UI design system

This document maps the production implementation of Foundation UI Identity v1.
The visual contract lives in `docs/UI_IDENTITY.md`; the task contract lives in
`docs/UI_TASK_PROMPT.md`. Runtime components and `src/styles.css` remain the
implementation source of truth.

## Production foundation

- Foundation UI Identity v1 is the only production UI. There is no visual
  preview allowlist, rollout mode, legacy route branch, or dark-pilot theme.
- Stack: React 19, TypeScript, React Router, TanStack Query, React Hook Form,
  Recharts, Vite, Capacitor, and plain global CSS.
- Onest is the product font with the system fallback declared in
  `docs/UI_IDENTITY.md`.
- Client and Trainer use the same mobile-first shell and semantic token system.
  Light and dark share markup and geometry; only token values change.
- Route identity classes scope screen-specific composition. They do not select
  between old and new UI.

## Tokens

### Light

| Role | Value |
| --- | --- |
| Background | `#FBFAF7` |
| Primary graphite | `#242426` |
| Text on primary | `#F6F2EA` |
| Raised / base / inset surfaces | `#F7F5F1`, `#EFEDE8`, `#E5E2DC` |
| Divider | `#DEDBD4` |
| Secondary | `#74736F` |
| Secondary strong on tinted surfaces | `#666560` |

### Dark

| Role | Value |
| --- | --- |
| Background | `#111214` |
| Primary milk | `#F1EDE6` |
| Text on primary | `#171719` |
| Base / raised / inset surfaces | `#1D1E21`, `#26272B`, `#191A1D` |
| Divider | `#303136` |
| Secondary | `#999A9F` |

Dark is not an automatic inversion. Surface depth, controls and active states
are visually checked separately. Pure black, purple glow and decorative
gradients are not part of the system.

### Semantic color

| Meaning | Light | Dark |
| --- | --- | --- |
| Success | `#2F6B4F` | `#8FC7A8` |
| Danger | `#A73737` | `#F0A0A0` |

Amber is reserved for current work or temporary attention. The red LIVE mark is
reserved for realtime state. Semantic color always has a text and/or icon cue
and is not used as decoration or as a full-card fill without a product reason.

## Typography

| Role | Size / weight |
| --- | --- |
| Display | 24 / 600 |
| Title / key numeric | 18 / 600 |
| Section | 16 / 600 |
| Body | 14 / 400 |
| UI / active control | 14 / 500 |
| Caption / compact label | 12 / 500 |
| Editable field | 16 / 400 |

Weight 600 is for headings, hierarchy and key numbers; 500 is for controls,
active states and compact labels; 400 is for body and editable content. It is
not valid to make the entire interface semibold. The readability of 14/400 must
be checked on the real surface and viewport.

## Spacing and geometry

- Core spacing rhythm: 4, 8, 12, 16, 20 and 24 px.
- Shared radii: 10 px compact, 14 px controls/inset surfaces and 18 px cards,
  sheets and major grouped surfaces.
- Base mobile actions are 48 px high for every semantic variant.
- A deliberate compact action is 44 px high and may be primary, secondary,
  ghost or destructive. Height never encodes priority.
- Inputs are at least 48 px high with 16 px editable text.
- Touch targets are at least 44×44 px.
- Light and dark keep identical geometry.
- Shadows are normally absent. Depth is expressed through surfaces and
  dividers, not glow.

## Shared components

`src/shared/ui.tsx` owns the application primitives:

- `Page`, page headers and back navigation;
- `AsyncView`, `Skeleton`, `StatePanel`, and `EmptyState`;
- `Field`, `Switch`, `SaveStatus`, and `StatusBadge`;
- `ConfirmDialog` through `useConfirm`;
- `OverflowMenu`, modal and bottom-sheet behavior.

Workout UI additionally composes `WorkoutCta`, `WorkoutChoice`,
`WorkoutStatus`, `WorkoutExerciseHeader`, `WorkoutSetTable` and the shared
composer contracts. New work should extend these narrowly instead of creating
a second primitive family.

### Actions and forms

- One state has one obvious primary action.
- Primary/secondary/ghost/destructive hierarchy comes from fill, contrast and
  visual weight, not different base heights.
- Disabled controls remain readable and do not use blanket low opacity.
- Pending mutations expose `aria-busy`, prevent duplicate submission and use
  a stateful label.
- Destructive actions use the danger semantic and explicit wording, and require
  confirmation where loss is material.
- Fields have visible labels; validation and recovery remain adjacent to the
  relevant input.

### Surfaces and states

- Cards use the accepted neutral surfaces and quiet dividers.
- Loading, empty, error, success and disabled states are implemented only when
  reachable in product logic.
- Recoverable errors have one visible retry action.
- Planned, current, confirmed, partial, skipped and failed workout states remain
  semantically distinct.
- Color is never the sole state cue.

### Navigation and icons

- Shared outline SVGs live in `src/shared/icons.tsx`.
- Icons use `currentColor`, rounded caps/joins and an approximately 1.8 stroke.
- Navigation includes text labels and a clear active state.
- Emoji are not used as navigation or primary action icons.
- Bottom navigation and immersive Live actions respect safe areas and keyboard
  visibility.

## Product patterns

### Client

- Acceptance widths are 390 and 430 px.
- Home remains voice-first with one dominant next action.
- Workouts separate upcoming plans from confirmed history.
- Progress is goal-aware and uses confirmed training facts.
- Profile owns theme selection and account preferences.

### Trainer

- Operational screens prioritize scanning and direct action.
- Clients, schedule and progress reuse the same typography, surfaces,
  navigation and controls.
- Forms use explicit labels and a single primary save action.
- Client detail composes goals, notes, workouts, progress and connection state
  without changing authorship or access rules.

### Workout lifecycle

- Live makes the current exercise and set dominant, keeps upcoming work compact
  and confirmed work stable.
- Confirmed sets are the only source of fact and records.
- Plan values, typed drafts and saved facts are never styled as interchangeable.
- Rest/current work uses amber only with a visible state label.
- Completion, personal records and save success use the success semantic.

## Responsive and accessibility checks

- Check client screens at 390 and 430 px; narrow WebKit smoke may additionally
  cover 360/375 px.
- Check trainer routes at the current mobile shell and the accepted desktop
  profile where a baseline exists.
- Use dynamic viewport units and iOS safe-area insets.
- Prevent document-level horizontal overflow; intentional rows may scroll.
- Verify keyboard-open layouts, focus visibility, long Russian copy, readable
  disabled states and 44 px touch targets.
- Respect `prefers-reduced-motion`.

## Retired implementation

The pre-identity stylesheet, rollback selectors, preview rollout and dark-pilot
theme were retired after the Progress merge. `ui-identity` is a permanent root
contract, not a feature switch. Historical migration and design records remain
immutable; they must not be copied into new runtime code.
