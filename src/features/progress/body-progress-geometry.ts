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
  chest: [{ cx: 239, cy: 284, rx: 43, ry: 35 }, { cx: 321, cy: 284, rx: 43, ry: 35 }],
  shoulders: [{ cx: 168, cy: 257, rx: 30, ry: 35, rotate: 18 }, { cx: 392, cy: 257, rx: 30, ry: 35, rotate: -18 }],
  biceps: [{ cx: 153, cy: 353, rx: 22, ry: 57, rotate: 8 }, { cx: 410, cy: 353, rx: 22, ry: 57, rotate: -8 }],
  triceps: [{ cx: 544, cy: 355, rx: 22, ry: 58, rotate: -8 }, { cx: 808, cy: 355, rx: 22, ry: 58, rotate: 8 }],
  forearms: [{ cx: 126, cy: 461, rx: 18, ry: 68, rotate: 9 }, { cx: 438, cy: 461, rx: 18, ry: 68, rotate: -9 }],
  core: [{ cx: 280, cy: 380, rx: 42, ry: 58 }, { cx: 280, cy: 445, rx: 35, ry: 45 }],
  upper_back: [
    { cx: 613, cy: 305, rx: 37, ry: 57, rotate: -14 },
    { cx: 745, cy: 305, rx: 37, ry: 57, rotate: 14 },
    { cx: 679, cy: 254, rx: 43, ry: 24 },
  ],
  lower_back: [{ cx: 646, cy: 417, rx: 34, ry: 52 }, { cx: 712, cy: 417, rx: 34, ry: 52 }],
  glutes: [{ cx: 631, cy: 531, rx: 45, ry: 40 }, { cx: 727, cy: 531, rx: 45, ry: 40 }],
  quadriceps: [{ cx: 237, cy: 657, rx: 39, ry: 103 }, { cx: 325, cy: 657, rx: 39, ry: 103 }],
  hamstrings: [{ cx: 633, cy: 656, rx: 36, ry: 101 }, { cx: 725, cy: 656, rx: 36, ry: 101 }],
  calves: [{ cx: 632, cy: 808, rx: 27, ry: 88 }, { cx: 725, cy: 808, rx: 27, ry: 88 }],
  inner_thigh: [{ cx: 265, cy: 653, rx: 21, ry: 99, rotate: -3 }, { cx: 297, cy: 653, rx: 21, ry: 99, rotate: 3 }],
  outer_thigh: [{ cx: 220, cy: 653, rx: 27, ry: 101 }, { cx: 342, cy: 653, rx: 27, ry: 101 }],
  arms: [
    { cx: 153, cy: 350, rx: 24, ry: 64, rotate: 8 }, { cx: 410, cy: 350, rx: 24, ry: 64, rotate: -8 },
    { cx: 126, cy: 460, rx: 19, ry: 71, rotate: 9 }, { cx: 438, cy: 460, rx: 19, ry: 71, rotate: -9 },
    { cx: 544, cy: 350, rx: 24, ry: 64, rotate: -8 }, { cx: 808, cy: 350, rx: 24, ry: 64, rotate: 8 },
  ],
  legs: [
    { cx: 237, cy: 707, rx: 42, ry: 198 }, { cx: 325, cy: 707, rx: 42, ry: 198 },
    { cx: 633, cy: 707, rx: 40, ry: 198 }, { cx: 725, cy: 707, rx: 40, ry: 198 },
  ],
  back: [
    { cx: 613, cy: 307, rx: 39, ry: 61, rotate: -13 }, { cx: 745, cy: 307, rx: 39, ry: 61, rotate: 13 },
    { cx: 646, cy: 416, rx: 35, ry: 53 }, { cx: 712, cy: 416, rx: 35, ry: 53 },
  ],
}

const female: BodyZoneGeometry = {
  chest: [{ cx: 210, cy: 286, rx: 34, ry: 31 }, { cx: 282, cy: 286, rx: 34, ry: 31 }],
  shoulders: [{ cx: 142, cy: 259, rx: 26, ry: 31, rotate: 17 }, { cx: 352, cy: 259, rx: 26, ry: 31, rotate: -17 }],
  biceps: [{ cx: 130, cy: 353, rx: 18, ry: 53, rotate: 7 }, { cx: 372, cy: 353, rx: 18, ry: 53, rotate: -7 }],
  triceps: [{ cx: 558, cy: 355, rx: 18, ry: 54, rotate: -7 }, { cx: 872, cy: 355, rx: 18, ry: 54, rotate: 7 }],
  forearms: [{ cx: 105, cy: 454, rx: 16, ry: 64, rotate: 7 }, { cx: 398, cy: 454, rx: 16, ry: 64, rotate: -7 }],
  core: [{ cx: 247, cy: 382, rx: 36, ry: 54 }, { cx: 247, cy: 444, rx: 31, ry: 42 }],
  upper_back: [
    { cx: 628, cy: 306, rx: 32, ry: 52, rotate: -13 },
    { cx: 798, cy: 306, rx: 32, ry: 52, rotate: 13 },
    { cx: 713, cy: 256, rx: 39, ry: 21 },
  ],
  lower_back: [{ cx: 678, cy: 417, rx: 29, ry: 48 }, { cx: 748, cy: 417, rx: 29, ry: 48 }],
  glutes: [{ cx: 666, cy: 532, rx: 40, ry: 42 }, { cx: 760, cy: 532, rx: 40, ry: 42 }],
  quadriceps: [{ cx: 205, cy: 654, rx: 34, ry: 99 }, { cx: 294, cy: 654, rx: 34, ry: 99 }],
  hamstrings: [{ cx: 670, cy: 655, rx: 32, ry: 98 }, { cx: 756, cy: 655, rx: 32, ry: 98 }],
  calves: [{ cx: 673, cy: 805, rx: 24, ry: 84 }, { cx: 756, cy: 805, rx: 24, ry: 84 }],
  inner_thigh: [{ cx: 233, cy: 652, rx: 19, ry: 95 }, { cx: 266, cy: 652, rx: 19, ry: 95 }],
  outer_thigh: [{ cx: 194, cy: 652, rx: 24, ry: 97 }, { cx: 305, cy: 652, rx: 24, ry: 97 }],
  arms: [
    { cx: 130, cy: 350, rx: 20, ry: 60, rotate: 7 }, { cx: 372, cy: 350, rx: 20, ry: 60, rotate: -7 },
    { cx: 105, cy: 454, rx: 17, ry: 67, rotate: 7 }, { cx: 398, cy: 454, rx: 17, ry: 67, rotate: -7 },
    { cx: 558, cy: 350, rx: 20, ry: 60, rotate: -7 }, { cx: 872, cy: 350, rx: 20, ry: 60, rotate: 7 },
  ],
  legs: [
    { cx: 205, cy: 703, rx: 37, ry: 190 }, { cx: 294, cy: 703, rx: 37, ry: 190 },
    { cx: 670, cy: 703, rx: 35, ry: 190 }, { cx: 756, cy: 703, rx: 35, ry: 190 },
  ],
  back: [
    { cx: 628, cy: 307, rx: 34, ry: 57, rotate: -13 }, { cx: 798, cy: 307, rx: 34, ry: 57, rotate: 13 },
    { cx: 678, cy: 416, rx: 30, ry: 49 }, { cx: 748, cy: 416, rx: 30, ry: 49 },
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

// Центры фигур внутри исходных 952×1000 ассетов различаются. Кадрируем каждый
// ракурс вокруг его реального центра, чтобы изображение и SVG-маски оставались
// одним координатным слоем и не съезжали друг относительно друга.
const figureCenters: Record<BodyFigureVariant, Record<BodyFigureSide, number>> = {
  male: { front: 280, back: 679 },
  female: { front: 247, back: 713 },
  neutral: { front: 280, back: 672 },
}

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

export function bodyFigureViewBox(variant: BodyFigureVariant, side: BodyFigureSide): string {
  const x = figureCenters[variant][side] - 238
  return `${x} 0 476 1000`
}

export function bodyFigureClipBox(side: BodyFigureSide) {
  return { x: side === 'front' ? 0 : 476, y: 0, width: 476, height: 1000 } as const
}
