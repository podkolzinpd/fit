import type { Gender } from '../../shared/domain'
import type { BodyMapZone } from './body-progress-map'

export interface BodyZoneShape {
  cx: number
  cy: number
  rx: number
  ry: number
  rotate?: number
  path?: string
}

export type BodyFigureVariant = Gender | 'neutral'
export type BodyFigureSide = 'front' | 'back'

export interface BodyFigureCanvas {
  width: number
  height: number
}

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

// Геометрия согласованной анатомической схемы задана прямо в координатах
// итогового 1495x1052 изображения. Она не наследует пропорции старой
// схематичной «куклы»: каждая зона лежит на соответствующем сегменте мышц.
const anatomicalNeutral: BodyZoneGeometry = {
  chest: [
    { cx: 428, cy: 266, rx: 50, ry: 52 },
    { cx: 516, cy: 266, rx: 50, ry: 52 },
  ],
  shoulders: [
    { cx: 374, cy: 233, rx: 45, ry: 42, rotate: 18 },
    { cx: 570, cy: 233, rx: 45, ry: 42, rotate: -18 },
  ],
  biceps: [
    { cx: 351, cy: 335, rx: 30, ry: 68, rotate: 9 },
    { cx: 593, cy: 335, rx: 30, ry: 68, rotate: -9 },
  ],
  triceps: [
    { cx: 874, cy: 334, rx: 30, ry: 68, rotate: -9 },
    { cx: 1161, cy: 334, rx: 30, ry: 68, rotate: 9 },
  ],
  forearms: [
    { cx: 306, cy: 468, rx: 24, ry: 77, rotate: 13 },
    { cx: 638, cy: 468, rx: 24, ry: 77, rotate: -13 },
  ],
  core: [
    { cx: 472, cy: 409, rx: 55, ry: 104 },
  ],
  upper_back: [
    { cx: 965, cy: 226, rx: 64, ry: 97, path: 'M986 130C959 142 928 164 901 185C927 207 954 242 979 286L1005 323V145C999 138 993 133 986 130Z' },
    { cx: 1071, cy: 226, rx: 64, ry: 97, path: 'M1050 130C1077 142 1108 164 1135 185C1109 207 1082 242 1057 286L1031 323V145C1037 138 1043 133 1050 130Z' },
    { cx: 955, cy: 352, rx: 55, ry: 113, path: 'M923 248C946 230 967 239 981 274L1008 331L1007 361L952 465C925 446 906 405 901 353C899 311 907 273 923 248Z' },
    { cx: 1081, cy: 352, rx: 55, ry: 113, path: 'M1113 248C1090 230 1069 239 1055 274L1028 331L1029 361L1084 465C1111 446 1130 405 1135 353C1137 311 1129 273 1113 248Z' },
  ],
  lower_back: [
    { cx: 980, cy: 454, rx: 42, ry: 80, rotate: -8 },
    { cx: 1056, cy: 454, rx: 42, ry: 80, rotate: 8 },
  ],
  glutes: [
    { cx: 966, cy: 549, rx: 55, ry: 55 },
    { cx: 1070, cy: 549, rx: 55, ry: 55 },
  ],
  quadriceps: [
    { cx: 419, cy: 639, rx: 48, ry: 112 },
    { cx: 526, cy: 639, rx: 48, ry: 112 },
  ],
  hamstrings: [
    { cx: 965, cy: 680, rx: 43, ry: 112 },
    { cx: 1071, cy: 680, rx: 43, ry: 112 },
  ],
  calves: [
    { cx: 961, cy: 838, rx: 35, ry: 94 },
    { cx: 1075, cy: 838, rx: 35, ry: 94 },
  ],
  inner_thigh: [
    { cx: 457, cy: 640, rx: 24, ry: 108, rotate: -3 },
    { cx: 487, cy: 640, rx: 24, ry: 108, rotate: 3 },
  ],
  outer_thigh: [
    { cx: 397, cy: 640, rx: 31, ry: 110, rotate: 4 },
    { cx: 547, cy: 640, rx: 31, ry: 110, rotate: -4 },
  ],
  arms: [
    { cx: 351, cy: 335, rx: 32, ry: 71, rotate: 9 },
    { cx: 593, cy: 335, rx: 32, ry: 71, rotate: -9 },
    { cx: 306, cy: 468, rx: 25, ry: 80, rotate: 13 },
    { cx: 638, cy: 468, rx: 25, ry: 80, rotate: -13 },
    { cx: 874, cy: 334, rx: 32, ry: 71, rotate: -9 },
    { cx: 1161, cy: 334, rx: 32, ry: 71, rotate: 9 },
  ],
  legs: [
    { cx: 419, cy: 734, rx: 51, ry: 211 },
    { cx: 526, cy: 734, rx: 51, ry: 211 },
    { cx: 965, cy: 744, rx: 48, ry: 205 },
    { cx: 1071, cy: 744, rx: 48, ry: 205 },
  ],
  back: [
    { cx: 952, cy: 310, rx: 70, ry: 95, rotate: -12 },
    { cx: 1084, cy: 310, rx: 70, ry: 95, rotate: 12 },
    { cx: 980, cy: 454, rx: 43, ry: 82, rotate: -8 },
    { cx: 1056, cy: 454, rx: 43, ry: 82, rotate: 8 },
  ],
}

const geometries: Record<BodyFigureVariant, BodyZoneGeometry> = { male, female, neutral: anatomicalNeutral }

// Центры фигур внутри исходных 952×1000 ассетов различаются. Кадрируем каждый
// ракурс вокруг его реального центра, чтобы изображение и SVG-маски оставались
// одним координатным слоем и не съезжали друг относительно друга.
const figureCenters: Record<BodyFigureVariant, Record<BodyFigureSide, number>> = {
  male: { front: 280, back: 679 },
  female: { front: 247, back: 713 },
  neutral: { front: 476, back: 1018 },
}

const figureCanvases: Record<BodyFigureVariant, BodyFigureCanvas> = {
  male: { width: 952, height: 1000 },
  female: { width: 952, height: 1000 },
  neutral: { width: 1495, height: 1052 },
}

const figureViewportWidths: Record<BodyFigureVariant, number> = {
  male: 476,
  female: 476,
  neutral: 500,
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
  const sideSplit = variant === 'neutral' ? 747.5 : 476
  return shapes.filter((shape) => side === 'front' ? shape.cx < sideSplit : shape.cx >= sideSplit)
}

export function bodyZoneSides(variant: BodyFigureVariant, zone: BodyMapZone): readonly BodyFigureSide[] {
  return (['front', 'back'] as const).filter((side) => bodyZoneShapes(variant, zone, side).length > 0)
}

export function bodyFigureViewBox(variant: BodyFigureVariant, side: BodyFigureSide): string {
  const canvas = figureCanvases[variant]
  const width = figureViewportWidths[variant]
  const x = figureCenters[variant][side] - width / 2
  return `${x} 0 ${width} ${canvas.height}`
}

export function bodyFigureClipBox(variant: BodyFigureVariant, side: BodyFigureSide) {
  const canvas = figureCanvases[variant]
  if (variant !== 'neutral') {
    return { x: side === 'front' ? 0 : 476, y: 0, width: 476, height: canvas.height } as const
  }
  const width = figureViewportWidths[variant]
  return {
    x: figureCenters[variant][side] - width / 2,
    y: 0,
    width,
    height: canvas.height,
  } as const
}

export function bodyFigureCanvas(variant: BodyFigureVariant): BodyFigureCanvas {
  return figureCanvases[variant]
}
