export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsv {
  /** Degrees, 0–360. Unstable when saturation is near zero. */
  h: number
  /** 0–1. */
  s: number
  /** 0–1. */
  v: number
}

export const MAX_RGB_DISTANCE = Math.sqrt(255 * 255 * 3)

export const COLOR_PRESETS = [
  { id: 'blue', label: 'Blue', rgb: { r: 32, g: 96, b: 214 } },
  { id: 'red', label: 'Red', rgb: { r: 196, g: 40, b: 48 } },
  { id: 'green', label: 'Green', rgb: { r: 40, g: 150, b: 70 } },
  { id: 'yellow', label: 'Yellow', rgb: { r: 220, g: 190, b: 40 } },
] as const

export type ColorPresetId = (typeof COLOR_PRESETS)[number]['id']

export const EMPTY_PLATE_RGB: Rgb = { r: 232, g: 232, b: 228 }
export const OLIVE_RGB: Rgb = { r: 118, g: 138, b: 86 }
export const BENCH_RGB: Rgb = { r: 186, g: 176, b: 160 }

export function presetById(id: ColorPresetId): (typeof COLOR_PRESETS)[number] {
  const preset = COLOR_PRESETS.find((item) => item.id === id)
  if (!preset) return COLOR_PRESETS[0]
  return preset
}

export function rgbToCss(rgb: Rgb): string {
  return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)})`
}

export function formatRgb(rgb: Rgb): string {
  return `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`
}

export function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Normalized 0–1 Euclidean distance. 1 is the far corner of the RGB cube. */
export function normalizedRgbDistance(a: Rgb, b: Rgb): number {
  return rgbDistance(a, b) / MAX_RGB_DISTANCE
}

export function rgbToHsv(rgb: Rgb): Hsv {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  }
}

export function hueDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360
  return delta > 180 ? 360 - delta : delta
}

/**
 * Heuristic 0–1 score for "this sample looks like the selected dye".
 * This is not a calibrated probability.
 * Without an empty-plate distance, separation is not rewarded; saturation still has to be high.
 * With a reference, a sample that still looks like the empty plate scores near 0.
 */
export function heuristicFillScore(sample: Rgb, expected: Rgb, emptyDistance: number | null): number {
  const sampleHsv = rgbToHsv(sample)
  const expectedHsv = rgbToHsv(expected)
  if (expectedHsv.s < 0.15) return 0
  const hue = Math.max(0, 1 - hueDistance(sampleHsv.h, expectedHsv.h) / 48)
  const saturation = clampUnit((sampleHsv.s - 0.15) / 0.4)
  const separation =
    emptyDistance == null ? 1 : clampUnit((emptyDistance - 0.08) / 0.18)
  return hue * saturation * separation
}

function clampUnit(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
