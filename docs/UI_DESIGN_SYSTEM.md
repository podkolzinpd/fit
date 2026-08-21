# Fit UI design system

This document records the system that exists in `main`; it is not a redesign
brief. Runtime behavior, feature components, and `src/styles.css` remain the
implementation source of truth. The purpose of this map is to make future UI
work consistent and easier to verify.

## Foundations

- Stack: React 19, TypeScript, React Router, TanStack Query, React Hook Form,
  Recharts, Vite, Capacitor, and plain global CSS. There is no Tailwind or
  installed component framework.
- Default product theme: `theme-light`, called **LIGHT PREMIUM PERFORMANCE** in
  the CSS. A dark token set remains as a build-time fallback.
- Dark has two token sets. The base one in `:root` is the coral fallback; the
  Figma-derived `theme-dark-pilot` set is served only to allowlisted accounts
  that also chose the dark theme themselves (see the pilot section below).
- Client and Trainer render inside `.phone-frame`, currently capped at 440 px.
  Client has four bottom tabs; Trainer has three in the current feature-flagged
  navigation. Live workout hides the tab bar and uses an immersive bottom bar.
- Semantic tokens are defined in `:root` and overridden by `.theme-light`.
  Prefer tokens over literal colors in new rules.

## Color and surfaces

The light theme uses warm neutrals and one coral action accent:

| Role | Current token/value |
| --- | --- |
| App background | `--bg: #f7f4ef` |
| Main text | `--fg: #17191d` |
| Muted text | `--muted: #6c717a` |
| Raised surface | `--surface-raised: #fffefc` |
| Sunken/input surface | `--surface-sunken`, `--input: #f2eee8` |
| Border | `--border: #e5ded3` |
| Primary fill | `--accent-grad`, based on `#f26b4a` / `#e85c3a` |
| Accent text | `--accent-strong: #a83714` for readable text contrast |
| Success | `--success`, `--success-surface`, `--success-border` |
| Warning | `--warning-*` |
| Destructive | `--danger`, `--danger-surface`, `--danger-border` |

Generic cards use `--surface-raised`, `--card-grad`, `--border`, and
`--shadow-card`. Voice-first, live-workout, AI summary, regularity, and client
AI cards have semantic token groups because their meaning and hierarchy differ.
These groups should not be used as arbitrary decoration on unrelated screens.

Workout states use the following fixed color contract. A text label or icon
always accompanies color, so meaning never depends on color alone:

| Meaning | Tone | Examples |
| --- | --- | --- |
| Primary action, current work, selected control | Coral accent | Current workout/set, submit CTA, selected RPE |
| Confirmed success or positive result | Green success | Saved set, completed workout, personal record |
| Temporary attention | Amber warning | Partial completion, saving, rest timer |
| Error, destructive action, or health concern | Red danger | Failed save, delete, discomfort |
| Context without urgency | Neutral | Planned/upcoming work, history, skipped set |

The red Live indicator is the one explicit realtime convention and uses its own
`--live-indicator` token; it must not reuse destructive surfaces or replace the
visible `LIVE` label.

## Dark pilot palette (`theme-dark-pilot`)

Ported from the Figma file «Фит», node `116-4449`. It is a second value set for
the existing dark theme, not a third theme and not a second token system: the
markup, selectors, roles and geometry stay the same, only values change.

| Role | Value | Source in the frame |
| --- | --- | --- |
| App background | `--bg: #000000` | screen background |
| Card / sheet | `--surface-raised: #1a1a1a`, `--card-grad: #1a1a1a` | exercise card |
| Inset control | `--surface-sunken: #2e2e2e` | segmented tracks, chips |
| Field / value pill | `--input: #3c3c3c` | weight and reps fields |
| Popover / menu | `--surface-elevated: #3a3a3a` | bottom sheets, overflow menu |
| Main text | `--fg: #ffffff` | all primary copy |
| Muted text | `--muted: #a1a1aa` | inactive tab, secondary copy |
| Primary fill | `--accent: #6e4ce6`, `--accent-grad` | assistant replies, CTA |
| Accent text | `--accent-strong: #a68cf0` | links, eyebrow labels |
| Frame glow | `--frame-bg` | violet gradient at the bottom edge |

Surfaces carry the hierarchy: lighter means higher, so the inset tokens sit
above the card here, unlike in the light theme. Borders are quieter
(`--border: #2b2b2b`) because the frame has almost none. Success, warning and
danger keep their meaning and are only retuned for a pure black background.

Two deliberate deviations from the frame, both for readability:

- The bottom glow is anchored to the frame bottom in pixels, not percent. Up to
  70 px from the bottom — where content still ends — it stays at most `#33236b`,
  so muted text keeps ≥5:1. Full strength lives only under the bar. With the
  keyboard open the glow is dropped entirely, because content padding shrinks.
- The bottom bar is dark glass instead of the frame's light glass. On ≤480 px
  the bar sits flush against the brightest part of the glow, where 11 px tab
  labels dropped to 2.9:1; dark glass keeps the violet showing through and
  returns the labels to ≥8:1.

The pilot lives in one token block plus one grouped list of selector overrides
at the end of `src/styles.css`, so it can be rolled out or deleted as a unit.

## Typography

- Font stack: `-apple-system`, BlinkMacSystemFont, `SF Pro Text`, Inter,
  `system-ui`, sans-serif. No downloadable brand font is required.
- Base: 16 px with 1.45 line height. Product content uses six semantic roles;
  feature CSS must not invent an intermediate role from a local pixel value.

| Content role | Size | Default treatment | Use |
| --- | --- | --- | --- |
| `display` | 30 px, fluid in page headers | 800, tight | page and hero heading |
| `title` | 22 px | 800, tight | card or major block title |
| `section` | 18 px | 700 | section heading |
| `body` | 16 px | 400; 700 for emphasis | primary reading text |
| `caption` | 12 px | 600 | metadata, supporting copy, eyebrow variant |
| `numeric` | 22 px | 800, tabular | primary measured value or count |

Operational workout labels are an accessibility exception to the compact
caption role: column headings, plan/fact context, Live hints, and history
metadata use at least 13 px and `--secondary-label-fg`. Twelve-pixel text is
reserved for self-contained badges or nonessential decorative metadata.

- CSS variables are `--type-<role>-size`; reusable classes are
  `.type-display`, `.type-title`, `.type-section`, `.type-body`,
  `.type-caption`, and `.type-numeric`.
- Uppercase eyebrow labels are a bold caption variant with
  `--tracking-label`. Control labels may keep `--text-ui` (14 px); icon marks
  may inherit their own size because they are not content typography.
- Weights are only 600, 700, and 800. Do not introduce intermediate 650/750
  weights. Large page headings use `--type-display-fluid` inside the
  390–440 px shell.
- The contract is migrated by real screens rather than a blind global rewrite.
  Client Progress/Workouts/Live and Trainer Clients/Schedule/Progress are the
  first protected set. Role Home for both users deliberately keeps its existing
  hierarchy and primary actions.

## Spacing, geometry, and effects

- Spacing tokens: 4, 8, 12, 16, 20, and 24 px (`--space-1`…`--space-6`).
- Canonical radii are semantic: `--radius-sm` (9 px) for compact segments,
  `--radius-md` (12 px) for controls and inset surfaces, `--radius-lg` (16 px)
  for cards, and `--radius-pill` (99 px) for chips. Frame and bottom-sheet
  shells may keep their separate 26–28 px geometry.
- Control heights are `--control-height-compact` (36 px),
  `--control-height-standard` (44 px), and `--control-height-primary` (50 px).
  Chips use `--chip-height` (32 px); ordinary cards use `--card-padding`
  (16 px), and major single-column sections use `--section-gap` (20 px).
- Client Progress/Workouts/Live and Trainer Clients/Schedule/Progress are the
  first protected geometry set. Role Home for both users deliberately keeps
  its existing cards, voice/text actions, and primary buttons.
- Cards use a restrained warm shadow (`--shadow-card`). Overlays use
  `--overlay` and blur; sheets rise from the bottom on mobile.
- Motion is short (about 180–220 ms) and must respect
  `prefers-reduced-motion`.

## Shared UI primitives

`src/shared/ui.tsx` owns the reusable application primitives:

- `Page` and page header/back navigation;
- `AsyncView`, `Skeleton`, `StatePanel`, and `EmptyState` for data states;
- `Field`, `Switch`, `SaveStatus`, and `StatusBadge`;
- in-app `ConfirmDialog` through `useConfirm`;
- `OverflowMenu`, positioned inside the phone frame and above fixed bars.

Global CSS also defines primary, secondary, tertiary/link, danger, wide, and
icon button styles; card stacks; form stacks/actions; badges; bottom tabs;
modal and bottom-sheet shells. New primitives should compose these contracts
instead of reproducing their pixels feature by feature.

Workout actions use the shared `WorkoutCta` hierarchy contract:

- `primary` is the single next-step action on the current screen;
- `secondary` is a reversible alternative or a lower-priority transition;
- `tertiary` is an optional, dismissive, or rare text action;
- `destructive` is reserved for deletion and always requires confirmation.

Interactive workout controls expose the same state contract instead of styling
feature-local classes independently:

- `WorkoutCta` owns `loading`, `disabled`, and `destructive` action states;
- `WorkoutChoice` owns neutral/destructive choices and the `selected` state;
- `WorkoutStatus` and completed workout surfaces own the `completed` state;
- pending controls retain their visual hierarchy, set `aria-busy`, and cannot
  be activated twice; selected choices set `aria-pressed`.

Post-workout RPE uses one continuous 1–10 slider with a large touch target,
the selected number, and a plain-language effort label. It must not return to
a two-row number grid that resembles a numeric keypad.

On Live, confirming the current set is the primary repeated action. Finishing
the whole workout remains secondary until the explicit completion confirmation
is open. A pending action preserves its hierarchy, changes its label, exposes
`aria-busy`, and cannot be submitted twice.

Data-state behavior follows one contract on the protected screens:

- root loading, empty, error, and unavailable states explain what is happening
  in one panel; section-level empty states use the compact variant;
- recoverable loading errors expose one visible `Повторить` action;
- an empty state names the missing data and the next useful action instead of
  leaving an empty page or a bare dash;
- a pending primary action is disabled against duplicate submission, sets
  `aria-busy`, and changes its label (`Сохраняем…`, `Завершаем…`, and so on);
- when the user remains on the same screen, save success or failure uses
  `SaveStatus`; successful actions that navigate use the destination screen as
  their confirmation.

Exercise media uses one `ExerciseImage` contract in the picker and exercise
detail: a square Fit surface, `object-fit: contain` so technique is not cropped,
and the same neutral exercise placeholder for missing or failed media.

A list filter field spans the full column on `--input`, carries `SearchIcon`
inside the field, and moves the focus ring to the wrapper through
`:focus-within` so icon and control share one outline. Its placeholder is real
copy, so it uses `--secondary-label-fg`; `--muted` on `--input` falls to about
4.2:1 in light and 4.3:1 in the dark pilot, below the AA threshold. The native
`type="search"` clear button is suppressed in favor of a labeled button with a
standard touch target. The field appears only when the list is long enough to
need it — Clients shows it from six entries.

This field ships behind the same default-off allowlist as the dark palette
(`isDarkThemePilotEnabled`), so it is a `.clients-search-pilot` block beside the
untouched `.clients-search` rules rather than a replacement. Outside the pilot
the screen renders exactly as before, which is why the committed visual
baselines do not move. Both the CSS block and the branch in `ClientsListPage`
are removed together when the pilot ends or ships to everyone.

Positive result emphasis is shared across secondary product surfaces:

- a confirmed personal record uses `RecordIcon`, a visible Russian label, and
  the success border/surface; the icon and color never carry meaning alone;
- Client Progress gives its single main result the same calm success surface;
- Trainer Progress marks weekly regularity as positive only after at least one
  completed workout; zero and unavailable data stay neutral;
- role Home remains unchanged and must not inherit these secondary-screen rules.

Progress copy is Russian-first: visible labels use `Личный рекорд`, `ИИ-анализ`
and `в неделю`, not unexplained `PR`, `AI` or `/ нед.` abbreviations. Percentages
are whole numbers, rates and displayed Progress measurements use at most one
decimal place, and counters select the correct Russian noun form.

## Icons

The primary icon language is a small set of hand-authored, outline SVGs in
`src/shared/icons.tsx` with `currentColor`, 24×24 viewBox, rounded line caps,
and roughly 1.8 stroke width. Navigation uses Clients, Schedule, Analytics, and
Profile icons. Voice and close/stop actions use the same file. Text labels and
accessible names remain mandatory.

## Client patterns

- Mobile-first shell at 390 px, checked again at 430 px, with four fixed bottom
  destinations: Cabinet, Workouts, Progress, Profile.
- Client Home is voice-first: microphone and text entry precede the next
  workout, weekly rhythm, one relevant highlight, and wearable context.
- Content uses a single-column stack, one dominant next action, warm raised
  cards, compact eyebrow labels, and explicit Russian copy.
- Client Progress uses one goal-aware LLM summary with 1/3/6 month periods,
  followed by body measurements, chart, and history. Current-week rhythm stays
  as a compact Home summary instead of a second large Progress card. A `done`
  workout counts even when some planned work was not completed.
- Personal records show exercise, exact confirmed result, record type, and link
  to that exercise's history.

## Trainer patterns

- The trainer currently uses the same capped phone-frame shell even on desktop.
- Today is the operational start: voice/text composition, client selection,
  review, assignment, and resume context. Client lists and schedule optimize for
  quick scanning rather than decorative analytics.
- Forms use explicit labels, inline validation, a clear primary save action,
  and secondary actions with lower emphasis.
- Client detail composes goal, note, workout, progress, and invitation surfaces
  while preserving role-based access and authorship.

## Workout UI

- `WorkoutComposer` is shared by Today and planning entry.
- `WorkoutExerciseHeader` and `WorkoutSetTable` align exercise and set structure
  across review, plan, live, and history without sharing their domain logic.
- Live workout makes the current set dominant, keeps upcoming work compact,
  collapses completed work, shows autosave, and reserves fixed bottom actions
  for the active session.
- Planned values, typed draft, confirmed fact, skipped work, partial completion,
  and personal records are visually and semantically distinct. Confirmed sets
  are the only source of fact and records.

## Responsive behavior

- Client acceptance widths are 390 and 430 px; legacy WebKit smoke also covers
  375 and 360 px for overflow regressions.
- The frame uses CSS dynamic viewport units and iOS safe-area insets; JavaScript
  never caches the app-shell height. Keyboard state alone is derived from Visual
  Viewport so fixed navigation/actions do not cover fields and the shell cannot
  remain shortened after the keyboard closes.
- Horizontal overflow is forbidden at the document level. Intentional tab rows
  may scroll horizontally and hide the scrollbar.
- Trainer desktop is now captured at 1440×1000 as a visual baseline; it records
  the current compact shell rather than implying a completed desktop redesign.

# Current UI inconsistencies / design debt

1. `src/styles.css` is a 1,300+ line global stylesheet containing foundations,
   primitives, and feature rules; ownership and deletion safety are weak.
2. The spacing and radius tokens exist, but many selectors still use one-off
   values such as 7, 10, 13, 17, 18, 20, 22, 26, and 28 px.
3. The light and dark token sets coexist, while several feature rules still
   contain literal colors. Theme parity can drift even though light is default.
4. Typography tokens coexist with many raw font sizes and local `clamp()`
   formulas, so hierarchy is not fully systematic.
5. Icons mix the shared SVG vocabulary with Unicode arrows, ellipses, plus
   signs, checks, and occasional emoji; weight and alignment are inconsistent.
6. Client and Trainer both remain in a 440 px phone frame at desktop widths.
   The trainer has no true wide operational layout yet.
7. Repeated feature cards and section headers often share visual structure but
   do not consistently compose a named primitive; careless extraction could,
   however, create an over-configurable mega-component.
8. Visual snapshots cover selected mobile flows, but coverage was not organized
   around Client 390/430 and Trainer 1440 profiles before YAFIT-297.
9. Generic, voice, AI, client-AI, progress, and live token groups overlap in
   surface and border responsibilities, making future token choice less clear.
10. Desktop hover styles exist for cards, while keyboard focus visibility is
    not documented or uniformly expressed for every custom control.
