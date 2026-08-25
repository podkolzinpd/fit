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

// Схематичная фигура использует точные контуры мышечных зон, а не широкие
// круговые пятна. cx/cy/rx/ry остаются как геометрические границы для
// определения стороны тела и доступной области нажатия.
const neutralFrontShoulders: readonly BodyZoneShape[] = [
  { cx: 151, cy: 244, rx: 32, ry: 41, path: 'M119 253C121 222 139 203 169 203C178 209 184 219 186 232C174 258 151 276 127 278C121 271 118 262 119 253Z' },
  { cx: 325, cy: 244, rx: 32, ry: 41, path: 'M357 253C355 222 337 203 307 203C298 209 292 219 290 232C302 258 325 276 349 278C355 271 358 262 357 253Z' },
]
const neutralFrontChest: readonly BodyZoneShape[] = [
  { cx: 199, cy: 274, rx: 38, ry: 41, path: 'M161 248C178 232 207 226 235 238V298C209 313 179 305 163 285C158 274 158 260 161 248Z' },
  { cx: 277, cy: 274, rx: 38, ry: 41, path: 'M315 248C298 232 269 226 241 238V298C267 313 297 305 313 285C318 274 318 260 315 248Z' },
]
const neutralFrontBiceps: readonly BodyZoneShape[] = [
  { cx: 112, cy: 345, rx: 23, ry: 64, path: 'M127 282C112 285 101 297 96 316L88 368C86 389 93 407 108 409C123 401 132 381 134 357L136 310C136 296 133 287 127 282Z' },
  { cx: 364, cy: 345, rx: 23, ry: 64, path: 'M349 282C364 285 375 297 380 316L388 368C390 389 383 407 368 409C353 401 344 381 342 357L340 310C340 296 343 287 349 282Z' },
]
const neutralFrontForearms: readonly BodyZoneShape[] = [
  { cx: 82, cy: 459, rx: 24, ry: 72, path: 'M100 399C87 397 76 407 70 427L57 481C52 503 58 524 72 531C87 527 96 512 99 490L106 431C108 416 106 405 100 399Z' },
  { cx: 394, cy: 459, rx: 24, ry: 72, path: 'M376 399C389 397 400 407 406 427L419 481C424 503 418 524 404 531C389 527 380 512 377 490L370 431C368 416 370 405 376 399Z' },
]
const neutralFrontCore: readonly BodyZoneShape[] = [
  { cx: 238, cy: 398, rx: 62, ry: 98, path: 'M183 307C202 320 218 324 238 324C258 324 274 320 293 307L300 390C296 438 279 477 252 496H224C197 477 180 438 176 390L183 307Z' },
]
const neutralFrontQuadriceps: readonly BodyZoneShape[] = [
  { cx: 193, cy: 651, rx: 43, ry: 112, path: 'M158 541C181 528 209 532 227 548L226 657C222 707 207 751 185 763C163 746 153 703 151 654L158 541Z' },
  { cx: 283, cy: 651, rx: 43, ry: 112, path: 'M318 541C295 528 267 532 249 548L250 657C254 707 269 751 291 763C313 746 323 703 325 654L318 541Z' },
]
const neutralFrontInnerThigh: readonly BodyZoneShape[] = [
  { cx: 222, cy: 649, rx: 20, ry: 106, path: 'M211 548C223 553 231 563 237 580L232 683C230 719 220 747 208 757C201 724 201 683 204 642L211 548Z' },
  { cx: 254, cy: 649, rx: 20, ry: 106, path: 'M265 548C253 553 245 563 239 580L244 683C246 719 256 747 268 757C275 724 275 683 272 642L265 548Z' },
]
const neutralFrontOuterThigh: readonly BodyZoneShape[] = [
  { cx: 172, cy: 651, rx: 27, ry: 108, path: 'M157 543C144 566 139 605 142 652C145 702 156 742 178 761C187 711 188 658 184 604C182 576 172 554 157 543Z' },
  { cx: 304, cy: 651, rx: 27, ry: 108, path: 'M319 543C332 566 337 605 334 652C331 702 320 742 298 761C289 711 288 658 292 604C294 576 304 554 319 543Z' },
]
const neutralBackTriceps: readonly BodyZoneShape[] = [
  { cx: 588, cy: 345, rx: 23, ry: 64, path: 'M603 282C588 285 577 297 572 316L564 368C562 389 569 407 584 409C599 401 608 381 610 357L612 310C612 296 609 287 603 282Z' },
  { cx: 840, cy: 345, rx: 23, ry: 64, path: 'M825 282C840 285 851 297 856 316L864 368C866 389 859 407 844 409C829 401 820 381 818 357L816 310C816 296 819 287 825 282Z' },
]
const neutralBackUpper: readonly BodyZoneShape[] = [
  { cx: 676, cy: 278, rx: 61, ry: 78, path: 'M675 196C641 205 613 220 598 246C606 292 631 326 675 349V196Z' },
  { cx: 752, cy: 278, rx: 61, ry: 78, path: 'M753 196C787 205 815 220 830 246C822 292 797 326 753 349V196Z' },
]
const neutralBackLower: readonly BodyZoneShape[] = [
  { cx: 684, cy: 411, rx: 35, ry: 69, path: 'M675 344C645 361 633 392 641 433C649 459 664 479 684 490C700 447 701 399 693 353L675 344Z' },
  { cx: 744, cy: 411, rx: 35, ry: 69, path: 'M753 344C783 361 795 392 787 433C779 459 764 479 744 490C728 447 727 399 735 353L753 344Z' },
]
const neutralBackGlutes: readonly BodyZoneShape[] = [
  { cx: 674, cy: 535, rx: 48, ry: 48, path: 'M631 507C654 492 689 494 711 513C710 551 696 577 672 585C646 578 630 550 631 507Z' },
  { cx: 754, cy: 535, rx: 48, ry: 48, path: 'M797 507C774 492 739 494 717 513C718 551 732 577 756 585C782 578 798 550 797 507Z' },
]
const neutralBackHamstrings: readonly BodyZoneShape[] = [
  { cx: 670, cy: 679, rx: 39, ry: 101, path: 'M637 574C661 566 687 570 704 589L701 699C696 744 683 775 665 785C644 762 635 724 633 679L637 574Z' },
  { cx: 758, cy: 679, rx: 39, ry: 101, path: 'M791 574C767 566 741 570 724 589L727 699C732 744 745 775 763 785C784 762 793 724 795 679L791 574Z' },
]
const neutralBackCalves: readonly BodyZoneShape[] = [
  { cx: 663, cy: 834, rx: 31, ry: 87, path: 'M642 759C659 750 678 755 688 774L692 844C688 888 677 922 661 933C645 913 636 879 635 842L642 759Z' },
  { cx: 765, cy: 834, rx: 31, ry: 87, path: 'M786 759C769 750 750 755 740 774L736 844C740 888 751 922 767 933C783 913 792 879 793 842L786 759Z' },
]

const neutral: BodyZoneGeometry = {
  chest: neutralFrontChest,
  shoulders: neutralFrontShoulders,
  biceps: neutralFrontBiceps,
  triceps: neutralBackTriceps,
  forearms: neutralFrontForearms,
  core: neutralFrontCore,
  upper_back: neutralBackUpper,
  lower_back: neutralBackLower,
  glutes: neutralBackGlutes,
  quadriceps: neutralFrontQuadriceps,
  hamstrings: neutralBackHamstrings,
  calves: neutralBackCalves,
  inner_thigh: neutralFrontInnerThigh,
  outer_thigh: neutralFrontOuterThigh,
  arms: [...neutralFrontBiceps, ...neutralFrontForearms, ...neutralBackTriceps],
  legs: [...neutralFrontQuadriceps, ...neutralFrontInnerThigh, ...neutralFrontOuterThigh, ...neutralBackHamstrings, ...neutralBackCalves],
  back: [...neutralBackUpper, ...neutralBackLower],
}

const geometries: Record<BodyFigureVariant, BodyZoneGeometry> = { male, female, neutral }

// Центры фигур внутри исходных 952×1000 ассетов различаются. Кадрируем каждый
// ракурс вокруг его реального центра, чтобы изображение и SVG-маски оставались
// одним координатным слоем и не съезжали друг относительно друга.
const figureCenters: Record<BodyFigureVariant, Record<BodyFigureSide, number>> = {
  male: { front: 280, back: 679 },
  female: { front: 247, back: 713 },
  neutral: { front: 238, back: 714 },
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
