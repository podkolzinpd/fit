import type { Gender } from '../../shared/domain'
import type { BodyMapZone } from './body-progress-map'

export interface BodyZoneShape {
  cx: number
  cy: number
  rx: number
  ry: number
  rotate?: number
}

export type BodyFigureVariant = Gender | 'neutral'

type BodyZoneGeometry = Record<BodyMapZone, readonly BodyZoneShape[]>

const male: BodyZoneGeometry = {
  chest: [{ cx: 242, cy: 280, rx: 48, ry: 42 }, { cx: 318, cy: 280, rx: 48, ry: 42 }],
  shoulders: [{ cx: 181, cy: 248, rx: 38, ry: 42 }, { cx: 379, cy: 248, rx: 38, ry: 42 }],
  biceps: [{ cx: 160, cy: 350, rx: 28, ry: 66, rotate: 8 }, { cx: 404, cy: 350, rx: 28, ry: 66, rotate: -8 }],
  triceps: [{ cx: 548, cy: 350, rx: 27, ry: 68, rotate: -8 }, { cx: 804, cy: 350, rx: 27, ry: 68, rotate: 8 }],
  forearms: [{ cx: 129, cy: 460, rx: 23, ry: 76, rotate: 9 }, { cx: 435, cy: 460, rx: 23, ry: 76, rotate: -9 }],
  core: [{ cx: 280, cy: 377, rx: 48, ry: 65 }, { cx: 280, cy: 449, rx: 42, ry: 53 }],
  upper_back: [
    { cx: 628, cy: 296, rx: 51, ry: 65, rotate: -10 },
    { cx: 716, cy: 296, rx: 51, ry: 65, rotate: 10 },
    { cx: 672, cy: 237, rx: 55, ry: 34 },
  ],
  lower_back: [{ cx: 638, cy: 420, rx: 43, ry: 61 }, { cx: 706, cy: 420, rx: 43, ry: 61 }],
  glutes: [{ cx: 626, cy: 522, rx: 53, ry: 48 }, { cx: 718, cy: 522, rx: 53, ry: 48 }],
  quadriceps: [{ cx: 238, cy: 655, rx: 46, ry: 116 }, { cx: 325, cy: 655, rx: 46, ry: 116 }],
  hamstrings: [{ cx: 630, cy: 650, rx: 43, ry: 113 }, { cx: 714, cy: 650, rx: 43, ry: 113 }],
  calves: [{ cx: 627, cy: 805, rx: 34, ry: 99 }, { cx: 716, cy: 805, rx: 34, ry: 99 }],
  inner_thigh: [{ cx: 269, cy: 650, rx: 28, ry: 110, rotate: -3 }, { cx: 296, cy: 650, rx: 28, ry: 110, rotate: 3 }],
  outer_thigh: [{ cx: 226, cy: 650, rx: 34, ry: 110 }, { cx: 338, cy: 650, rx: 34, ry: 110 }],
  arms: [
    { cx: 160, cy: 342, rx: 30, ry: 78, rotate: 8 }, { cx: 404, cy: 342, rx: 30, ry: 78, rotate: -8 },
    { cx: 129, cy: 458, rx: 24, ry: 82, rotate: 9 }, { cx: 435, cy: 458, rx: 24, ry: 82, rotate: -9 },
    { cx: 548, cy: 342, rx: 29, ry: 79, rotate: -8 }, { cx: 804, cy: 342, rx: 29, ry: 79, rotate: 8 },
  ],
  legs: [
    { cx: 239, cy: 707, rx: 51, ry: 214 }, { cx: 326, cy: 707, rx: 51, ry: 214 },
    { cx: 630, cy: 707, rx: 51, ry: 214 }, { cx: 714, cy: 707, rx: 51, ry: 214 },
  ],
  back: [
    { cx: 628, cy: 300, rx: 53, ry: 72, rotate: -9 }, { cx: 716, cy: 300, rx: 53, ry: 72, rotate: 9 },
    { cx: 640, cy: 417, rx: 45, ry: 68 }, { cx: 704, cy: 417, rx: 45, ry: 68 },
  ],
}

const female: BodyZoneGeometry = {
  chest: [{ cx: 247, cy: 286, rx: 43, ry: 38 }, { cx: 317, cy: 286, rx: 43, ry: 38 }],
  shoulders: [{ cx: 202, cy: 251, rx: 34, ry: 37 }, { cx: 362, cy: 251, rx: 34, ry: 37 }],
  biceps: [{ cx: 181, cy: 350, rx: 24, ry: 62, rotate: 7 }, { cx: 383, cy: 350, rx: 24, ry: 62, rotate: -7 }],
  triceps: [{ cx: 558, cy: 350, rx: 24, ry: 63, rotate: -7 }, { cx: 780, cy: 350, rx: 24, ry: 63, rotate: 7 }],
  forearms: [{ cx: 158, cy: 452, rx: 21, ry: 74, rotate: 7 }, { cx: 406, cy: 452, rx: 21, ry: 74, rotate: -7 }],
  core: [{ cx: 282, cy: 381, rx: 43, ry: 61 }, { cx: 282, cy: 449, rx: 38, ry: 49 }],
  upper_back: [
    { cx: 630, cy: 301, rx: 44, ry: 59, rotate: -9 },
    { cx: 708, cy: 301, rx: 44, ry: 59, rotate: 9 },
    { cx: 669, cy: 245, rx: 48, ry: 31 },
  ],
  lower_back: [{ cx: 638, cy: 419, rx: 38, ry: 56 }, { cx: 700, cy: 419, rx: 38, ry: 56 }],
  glutes: [{ cx: 628, cy: 526, rx: 49, ry: 50 }, { cx: 710, cy: 526, rx: 49, ry: 50 }],
  quadriceps: [{ cx: 245, cy: 650, rx: 43, ry: 111 }, { cx: 320, cy: 650, rx: 43, ry: 111 }],
  hamstrings: [{ cx: 632, cy: 650, rx: 41, ry: 110 }, { cx: 706, cy: 650, rx: 41, ry: 110 }],
  calves: [{ cx: 632, cy: 801, rx: 31, ry: 95 }, { cx: 706, cy: 801, rx: 31, ry: 95 }],
  inner_thigh: [{ cx: 271, cy: 649, rx: 25, ry: 105 }, { cx: 294, cy: 649, rx: 25, ry: 105 }],
  outer_thigh: [{ cx: 234, cy: 650, rx: 31, ry: 108 }, { cx: 331, cy: 650, rx: 31, ry: 108 }],
  arms: [
    { cx: 181, cy: 342, rx: 26, ry: 75, rotate: 7 }, { cx: 383, cy: 342, rx: 26, ry: 75, rotate: -7 },
    { cx: 158, cy: 454, rx: 22, ry: 78, rotate: 7 }, { cx: 406, cy: 454, rx: 22, ry: 78, rotate: -7 },
    { cx: 558, cy: 342, rx: 26, ry: 75, rotate: -7 }, { cx: 780, cy: 342, rx: 26, ry: 75, rotate: 7 },
  ],
  legs: [
    { cx: 245, cy: 703, rx: 47, ry: 207 }, { cx: 320, cy: 703, rx: 47, ry: 207 },
    { cx: 632, cy: 703, rx: 47, ry: 207 }, { cx: 706, cy: 703, rx: 47, ry: 207 },
  ],
  back: [
    { cx: 630, cy: 302, rx: 47, ry: 66, rotate: -8 }, { cx: 708, cy: 302, rx: 47, ry: 66, rotate: 8 },
    { cx: 640, cy: 416, rx: 40, ry: 61 }, { cx: 698, cy: 416, rx: 40, ry: 61 },
  ],
}

const neutral: BodyZoneGeometry = {
  ...male,
  chest: [{ cx: 276, cy: 283, rx: 70, ry: 48 }],
  shoulders: [{ cx: 201, cy: 252, rx: 42, ry: 41 }, { cx: 351, cy: 252, rx: 42, ry: 41 }],
  core: [{ cx: 276, cy: 413, rx: 57, ry: 98 }],
  upper_back: [{ cx: 676, cy: 308, rx: 96, ry: 72 }],
  lower_back: [{ cx: 676, cy: 421, rx: 65, ry: 61 }],
  glutes: [{ cx: 676, cy: 522, rx: 82, ry: 57 }],
}

const geometries: Record<BodyFigureVariant, BodyZoneGeometry> = { male, female, neutral }

export function bodyFigureVariant(gender: Gender | null): BodyFigureVariant {
  return gender ?? 'neutral'
}

export function bodyZoneShapes(variant: BodyFigureVariant, zone: BodyMapZone): readonly BodyZoneShape[] {
  return geometries[variant][zone]
}
