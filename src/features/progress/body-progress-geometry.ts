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
export type BodyFigureSide = 'front' | 'back'

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
  chest: [{ cx: 215, cy: 286, rx: 39, ry: 36 }, { cx: 277, cy: 286, rx: 39, ry: 36 }],
  shoulders: [{ cx: 171, cy: 250, rx: 32, ry: 36 }, { cx: 338, cy: 250, rx: 32, ry: 36 }],
  biceps: [{ cx: 146, cy: 350, rx: 23, ry: 61, rotate: 7 }, { cx: 365, cy: 350, rx: 23, ry: 61, rotate: -7 }],
  triceps: [{ cx: 575, cy: 350, rx: 23, ry: 62, rotate: -7 }, { cx: 840, cy: 350, rx: 23, ry: 62, rotate: 7 }],
  forearms: [{ cx: 116, cy: 452, rx: 20, ry: 73, rotate: 7 }, { cx: 395, cy: 452, rx: 20, ry: 73, rotate: -7 }],
  core: [{ cx: 247, cy: 381, rx: 42, ry: 60 }, { cx: 247, cy: 449, rx: 37, ry: 48 }],
  upper_back: [
    { cx: 666, cy: 301, rx: 45, ry: 58, rotate: -9 },
    { cx: 756, cy: 301, rx: 45, ry: 58, rotate: 9 },
    { cx: 711, cy: 245, rx: 51, ry: 30 },
  ],
  lower_back: [{ cx: 682, cy: 419, rx: 36, ry: 55 }, { cx: 742, cy: 419, rx: 36, ry: 55 }],
  glutes: [{ cx: 670, cy: 526, rx: 47, ry: 49 }, { cx: 752, cy: 526, rx: 47, ry: 49 }],
  quadriceps: [{ cx: 214, cy: 650, rx: 41, ry: 110 }, { cx: 291, cy: 650, rx: 41, ry: 110 }],
  hamstrings: [{ cx: 675, cy: 650, rx: 39, ry: 109 }, { cx: 748, cy: 650, rx: 39, ry: 109 }],
  calves: [{ cx: 676, cy: 801, rx: 30, ry: 94 }, { cx: 747, cy: 801, rx: 30, ry: 94 }],
  inner_thigh: [{ cx: 239, cy: 649, rx: 24, ry: 104 }, { cx: 264, cy: 649, rx: 24, ry: 104 }],
  outer_thigh: [{ cx: 203, cy: 650, rx: 30, ry: 107 }, { cx: 307, cy: 650, rx: 30, ry: 107 }],
  arms: [
    { cx: 146, cy: 342, rx: 25, ry: 74, rotate: 7 }, { cx: 365, cy: 342, rx: 25, ry: 74, rotate: -7 },
    { cx: 116, cy: 454, rx: 21, ry: 77, rotate: 7 }, { cx: 395, cy: 454, rx: 21, ry: 77, rotate: -7 },
    { cx: 575, cy: 342, rx: 25, ry: 74, rotate: -7 }, { cx: 840, cy: 342, rx: 25, ry: 74, rotate: 7 },
  ],
  legs: [
    { cx: 214, cy: 703, rx: 45, ry: 206 }, { cx: 291, cy: 703, rx: 45, ry: 206 },
    { cx: 675, cy: 703, rx: 45, ry: 206 }, { cx: 748, cy: 703, rx: 45, ry: 206 },
  ],
  back: [
    { cx: 667, cy: 302, rx: 45, ry: 65, rotate: -8 }, { cx: 755, cy: 302, rx: 45, ry: 65, rotate: 8 },
    { cx: 683, cy: 416, rx: 38, ry: 60 }, { cx: 741, cy: 416, rx: 38, ry: 60 },
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

export function bodyZoneShapes(
  variant: BodyFigureVariant,
  zone: BodyMapZone,
  side?: BodyFigureSide,
): readonly BodyZoneShape[] {
  const shapes = geometries[variant][zone]
  if (!side) return shapes
  return shapes.filter((shape) => side === 'front' ? shape.cx < 476 : shape.cx >= 476)
}

export function bodyZoneSides(variant: BodyFigureVariant, zone: BodyMapZone): readonly BodyFigureSide[] {
  return (['front', 'back'] as const).filter((side) => bodyZoneShapes(variant, zone, side).length > 0)
}

export function bodyFigureViewBox(side: BodyFigureSide): string {
  return side === 'front' ? '0 0 476 1000' : '476 0 476 1000'
}
