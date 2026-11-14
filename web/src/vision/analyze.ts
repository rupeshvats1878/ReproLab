import { WELL_IDS, type WellId, type WellState } from '../shared/types.ts'
import {
  heuristicFillScore,
  normalizedRgbDistance,
  type Rgb,
} from './color.ts'
import { type NormRect, type WellRegions } from './geometry.ts'

/**
 * Appearance thresholds.
 * Entering filled or empty takes stronger evidence than staying there.
 * mixUnknown treats a mixed region as unknown. It is not hand or pipette detection.
 */
export interface AnalysisThresholds {
  fillEnter: number
  fillExit: number
  emptyEnter: number
  emptyExit: number
  mixUnknown: number
}

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  fillEnter: 0.55,
  fillExit: 0.35,
  emptyEnter: 0.08,
  emptyExit: 0.14,
  mixUnknown: 0.4,
}

export interface WellMeasurement {
  wellId: WellId
  state: WellState
  /** Heuristic 0–1 dye match. Not a calibrated probability. */
  fillScore: number
  /** 0–1 distance from this well's empty-plate sample. Null when no reference was captured. */
  emptyDistance: number | null
  /** 0–1 spatial color spread. High means the region is mixed, so the state is unknown. */
  mixScore: number
  mean: Rgb
  sampleCount: number
}

export interface AnalysisProfile {
  expectedColor: Rgb
  emptyReference: Partial<Record<WellId, Rgb>> | null
  thresholds?: AnalysisThresholds
}

const INNER_INSET = 0.15

export function analyzeFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  regions: WellRegions,
  profile: AnalysisProfile,
  previous: Readonly<Record<WellId, WellState>>,
): WellMeasurement[] {
  const thresholds = profile.thresholds ?? DEFAULT_THRESHOLDS
  return WELL_IDS.map((wellId) => {
    const stats = readRegionStats(data, width, height, regions[wellId])
    const reference = profile.emptyReference?.[wellId] ?? null
    const emptyDistance =
      reference == null ? null : normalizedRgbDistance(stats.mean, reference)
    const fillScore = heuristicFillScore(stats.mean, profile.expectedColor, emptyDistance)
    const state =
      stats.count < 4
        ? 'unknown'
        : classifyAppearance(
            fillScore,
            emptyDistance,
            stats.mixScore,
            previous[wellId],
            reference != null,
            thresholds,
          )
    return {
      wellId,
      state,
      fillScore,
      emptyDistance,
      mixScore: stats.mixScore,
      mean: stats.mean,
      sampleCount: stats.count,
    }
  })
}

export function emptyReferenceFromBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  regions: WellRegions,
): Record<WellId, Rgb> {
  const reference = {} as Record<WellId, Rgb>
  for (const wellId of WELL_IDS) {
    reference[wellId] = readRegionStats(data, width, height, regions[wellId]).mean
  }
  return reference
}

export function readPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  nx: number,
  ny: number,
): Rgb | null {
  if (width <= 0 || height <= 0) return null
  const x = Math.min(width - 1, Math.max(0, Math.floor(nx * width)))
  const y = Math.min(height - 1, Math.max(0, Math.floor(ny * height)))
  const index = (y * width + x) * 4
  return {
    r: data[index] ?? 0,
    g: data[index + 1] ?? 0,
    b: data[index + 2] ?? 0,
  }
}

export function measurementStates(
  measurements: readonly WellMeasurement[],
): Record<WellId, WellState> {
  const states = {} as Record<WellId, WellState>
  for (const measurement of measurements) states[measurement.wellId] = measurement.state
  return states
}

/**
 * Hysteresis around the heuristic score.
 * A value between the enter and exit bands keeps the previous call.
 * Mixed regions and weak evidence stay unknown instead of being forced empty or filled.
 */
export function classifyAppearance(
  fillScore: number,
  emptyDistance: number | null,
  mixScore: number,
  previous: WellState,
  hasReference: boolean,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): WellState {
  if (mixScore >= thresholds.mixUnknown) return 'unknown'

  const strongFill = fillScore >= thresholds.fillEnter
  const holdFill = fillScore >= thresholds.fillExit
  const strongEmpty =
    hasReference &&
    emptyDistance != null &&
    emptyDistance <= thresholds.emptyEnter &&
    fillScore < thresholds.fillExit
  const holdEmpty =
    hasReference &&
    emptyDistance != null &&
    emptyDistance <= thresholds.emptyExit &&
    fillScore < thresholds.fillEnter

  if (previous === 'filled') {
    if (holdFill) return 'filled'
    if (strongEmpty) return 'empty'
    return 'unknown'
  }
  if (previous === 'empty') {
    if (strongFill) return 'filled'
    if (holdEmpty) return 'empty'
    return 'unknown'
  }
  if (strongFill) return 'filled'
  if (strongEmpty) return 'empty'
  return 'unknown'
}

export function readRegionStats(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  region: NormRect,
): { mean: Rgb; mixScore: number; count: number } {
  const bounds = innerBounds(width, height, region)
  if (!bounds) return { mean: { r: 0, g: 0, b: 0 }, mixScore: 1, count: 0 }

  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const index = (y * width + x) * 4
      sumR += data[index] ?? 0
      sumG += data[index + 1] ?? 0
      sumB += data[index + 2] ?? 0
      count += 1
    }
  }
  if (count === 0) return { mean: { r: 0, g: 0, b: 0 }, mixScore: 1, count: 0 }

  const mean = { r: sumR / count, g: sumG / count, b: sumB / count }
  let sumSq = 0
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const index = (y * width + x) * 4
      const dr = (data[index] ?? 0) - mean.r
      const dg = (data[index + 1] ?? 0) - mean.g
      const db = (data[index + 2] ?? 0) - mean.b
      sumSq += dr * dr + dg * dg + db * db
    }
  }
  const rms = Math.sqrt(sumSq / count)
  return { mean, mixScore: Math.min(1, rms / 90), count }
}

function innerBounds(
  width: number,
  height: number,
  region: NormRect,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (width <= 0 || height <= 0) return null
  const x = region.x + region.w * INNER_INSET
  const y = region.y + region.h * INNER_INSET
  const w = region.w * (1 - INNER_INSET * 2)
  const h = region.h * (1 - INNER_INSET * 2)
  if (w <= 0 || h <= 0) return null
  const x0 = clampIndex(Math.floor(x * width), 0, width)
  const y0 = clampIndex(Math.floor(y * height), 0, height)
  const x1 = clampIndex(Math.ceil((x + w) * width), 0, width)
  const y1 = clampIndex(Math.ceil((y + h) * height), 0, height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x0, y0, x1, y1 }
}

function clampIndex(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
