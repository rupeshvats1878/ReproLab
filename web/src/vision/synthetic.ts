import { WELL_IDS, type WellId } from '../shared/types.ts'
import { initialWellStates } from '../shared/protocol.ts'
import {
  analyzeFrame,
  emptyReferenceFromBuffer,
  measurementStates,
  type WellMeasurement,
} from './analyze.ts'
import {
  BENCH_RGB,
  COLOR_PRESETS,
  EMPTY_PLATE_RGB,
  OLIVE_RGB,
  type Rgb,
} from './color.ts'
import { defaultWellRegions, type NormRect, type WellRegions } from './geometry.ts'
import { ObservationEmitter, ReadingStabilizer } from './stabilize.ts'
import type { ObservationDraft, WellState } from '../shared/types.ts'

export const SYNTHETIC_WIDTH = 240
export const SYNTHETIC_HEIGHT = 160

export type WellPaint = 'empty' | 'filled' | 'olive' | 'checker' | 'noise'

export interface SyntheticFrame {
  width: number
  height: number
  data: Uint8ClampedArray
  label: string
}

export interface SyntheticSequence {
  id: string
  title: string
  detail: string
  frames: SyntheticFrame[]
}

interface ScriptStep {
  hold: number
  paints: Partial<Record<WellId, WellPaint>>
  label: string
}

const FILLED = COLOR_PRESETS[0].rgb

export function paintFrame(
  paints: Partial<Record<WellId, WellPaint>>,
  label: string,
  seed = 1,
  regions: WellRegions = defaultWellRegions(),
  width = SYNTHETIC_WIDTH,
  height = SYNTHETIC_HEIGHT,
): SyntheticFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  fillRect(data, width, 0, 0, width, height, BENCH_RGB)
  const random = mulberry32(seed)
  for (const wellId of WELL_IDS) {
    const paint = paints[wellId] ?? 'empty'
    const rect = pixelRect(regions[wellId], width, height)
    for (let y = rect.y0; y < rect.y1; y += 1) {
      for (let x = rect.x0; x < rect.x1; x += 1) {
        writePixel(data, width, x, y, colorAt(paint, x, y, random))
      }
    }
  }
  return { width, height, data, label }
}

export function framesFromScript(steps: readonly ScriptStep[]): SyntheticFrame[] {
  const frames: SyntheticFrame[] = []
  steps.forEach((step, stepIndex) => {
    for (let hold = 0; hold < step.hold; hold += 1) {
      frames.push(paintFrame(step.paints, `${step.label} ${hold + 1}`, stepIndex * 100 + hold + 1))
    }
  })
  return frames
}

export function sequenceFillInOrder(): SyntheticFrame[] {
  const steps: ScriptStep[] = [{ hold: 4, paints: {}, label: 'all empty' }]
  const filled: WellId[] = []
  for (const wellId of WELL_IDS) {
    filled.push(wellId)
    steps.push({
      hold: 4,
      paints: paintsFilled(filled),
      label: `filled through ${wellId}`,
    })
  }
  return framesFromScript(steps)
}

export function sequenceSkipA2ThenFill(): SyntheticFrame[] {
  return framesFromScript([
    { hold: 4, paints: {}, label: 'all empty' },
    { hold: 4, paints: paintsFilled(['A1']), label: 'A1 filled' },
    { hold: 4, paints: paintsFilled(['A1', 'A3']), label: 'A3 filled, A2 still empty' },
    { hold: 4, paints: paintsFilled(['A1', 'A2', 'A3']), label: 'A2 filled later' },
  ])
}

export function sequenceSkipA1(): SyntheticFrame[] {
  return framesFromScript([
    { hold: 4, paints: {}, label: 'all empty' },
    { hold: 4, paints: paintsFilled(['A2']), label: 'A2 filled, A1 still empty' },
  ])
}

export function sequenceSkipB2(): SyntheticFrame[] {
  return framesFromScript([
    { hold: 4, paints: {}, label: 'all empty' },
    { hold: 4, paints: paintsFilled(['A1']), label: 'A1' },
    { hold: 4, paints: paintsFilled(['A1', 'A2']), label: 'A2' },
    { hold: 4, paints: paintsFilled(['A1', 'A2', 'A3']), label: 'A3' },
    { hold: 4, paints: paintsFilled(['A1', 'A2', 'A3', 'B1']), label: 'B1' },
    { hold: 4, paints: paintsFilled(['A1', 'A2', 'A3', 'B1', 'B3']), label: 'B3 filled, B2 still empty' },
  ])
}

export function sequenceBriefNoise(): SyntheticFrame[] {
  return framesFromScript([
    { hold: 4, paints: {}, label: 'all empty' },
    { hold: 1, paints: { A1: 'noise' }, label: 'brief noise on A1' },
    { hold: 4, paints: {}, label: 'empty again' },
  ])
}

export function sequenceUncertain(): SyntheticFrame[] {
  return framesFromScript([
    { hold: 4, paints: {}, label: 'all empty' },
    { hold: 6, paints: { A1: 'checker' }, label: 'A1 mixed' },
    { hold: 4, paints: { A1: 'olive', A2: 'filled' }, label: 'A1 olive, A2 filled' },
  ])
}

export const SYNTHETIC_SEQUENCES: readonly {
  id: string
  title: string
  detail: string
  build: () => SyntheticFrame[]
}[] = [
  {
    id: 'fill-order',
    title: 'All wells filled in order',
    detail: 'A1 through B3 become filled one at a time. This is a drawn sequence, not a camera.',
    build: sequenceFillInOrder,
  },
  {
    id: 'skip-a2-then-fill',
    title: 'A2 skipped, then filled',
    detail: 'A3 is filled while A2 is still empty. A later frame fills A2. Resolution is a human action.',
    build: sequenceSkipA2ThenFill,
  },
  {
    id: 'skip-a1',
    title: 'A1 skipped',
    detail: 'A2 is filled while A1 is still empty.',
    build: sequenceSkipA1,
  },
  {
    id: 'skip-b2',
    title: 'B2 left empty',
    detail: 'B3 is filled while B2 stays empty.',
    build: sequenceSkipB2,
  },
  {
    id: 'brief-noise',
    title: 'Brief noise on A1',
    detail: 'One noisy frame should not change the stable empty reading.',
    build: sequenceBriefNoise,
  },
  {
    id: 'uncertain',
    title: 'Uncertain A1, then A2 filled',
    detail: 'Mixed and off-color pixels stay unknown. They are not promoted to filled.',
    build: sequenceUncertain,
  },
]

export interface AnalyzedSequence {
  observations: ObservationDraft[]
  raw: WellState[][]
  measurements: WellMeasurement[][]
  committed: Record<WellId, WellState>
}

/**
 * Play drawn frames through the same analyzer, stabilizer, and emitter used for the camera.
 * The empty-plate reference is the first frame. Results are synthetic.
 */
export function analyzeSequence(
  frames: readonly SyntheticFrame[],
  options?: { stableFrames?: number; frameMs?: number; expectedColor?: Rgb; regions?: WellRegions },
): AnalyzedSequence {
  if (frames.length === 0) {
    return {
      observations: [],
      raw: [],
      measurements: [],
      committed: initialWellStates(),
    }
  }
  const first = frames[0]
  if (!first) {
    return {
      observations: [],
      raw: [],
      measurements: [],
      committed: initialWellStates(),
    }
  }
  const regions = options?.regions ?? defaultWellRegions()
  const reference = emptyReferenceFromBuffer(first.data, first.width, first.height, regions)
  const expectedColor = options?.expectedColor ?? FILLED
  const stabilizer = new ReadingStabilizer(options?.stableFrames ?? 4)
  const emitter = new ObservationEmitter()
  let previous = initialWellStates()
  const observations: ObservationDraft[] = []
  const raw: WellState[][] = []
  const measurements: WellMeasurement[][] = []
  let elapsed = 0
  const frameMs = options?.frameMs ?? 200

  for (const frame of frames) {
    const measured = analyzeFrame(
      frame.data,
      frame.width,
      frame.height,
      regions,
      { expectedColor, emptyReference: reference },
      previous,
    )
    const rawStates = measurementStates(measured)
    previous = rawStates
    raw.push(WELL_IDS.map((wellId) => rawStates[wellId]))
    measurements.push(measured)
    const stable = stabilizer.push(rawStates)
    elapsed += frameMs
    if (stable.changed) {
      const draft = emitter.consider(elapsed, stable.states)
      if (draft) observations.push(draft)
    }
  }

  return {
    observations,
    raw,
    measurements,
    committed: stabilizer.snapshot(),
  }
}

function paintsFilled(ids: readonly WellId[]): Partial<Record<WellId, WellPaint>> {
  const paints: Partial<Record<WellId, WellPaint>> = {}
  for (const wellId of ids) paints[wellId] = 'filled'
  return paints
}

function colorAt(
  paint: WellPaint,
  x: number,
  y: number,
  random: () => number,
): Rgb {
  if (paint === 'filled') return FILLED
  if (paint === 'olive') return OLIVE_RGB
  if (paint === 'checker') return (x + y) % 2 === 0 ? FILLED : EMPTY_PLATE_RGB
  if (paint === 'noise') {
    return {
      r: Math.floor(random() * 256),
      g: Math.floor(random() * 256),
      b: Math.floor(random() * 256),
    }
  }
  return EMPTY_PLATE_RGB
}

function pixelRect(
  region: NormRect,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = clampIndex(Math.floor(region.x * width), 0, width)
  const y0 = clampIndex(Math.floor(region.y * height), 0, height)
  const x1 = clampIndex(Math.ceil((region.x + region.w) * width), x0 + 1, width)
  const y1 = clampIndex(Math.ceil((region.y + region.h) * height), y0 + 1, height)
  return { x0, y0, x1, y1 }
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgb,
): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) writePixel(data, width, x, y, color)
  }
}

function writePixel(data: Uint8ClampedArray, width: number, x: number, y: number, color: Rgb): void {
  const index = (y * width + x) * 4
  data[index] = color.r
  data[index + 1] = color.g
  data[index + 2] = color.b
  data[index + 3] = 255
}

function clampIndex(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
