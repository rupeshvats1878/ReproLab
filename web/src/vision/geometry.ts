import { WELL_IDS, type WellId } from '../shared/types.ts'

/** Region in fractions of the media frame, origin at the top left. */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** Pixel box relative to a container, after object-fit contain. */
export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

export type WellRegions = Record<WellId, NormRect>

const MIN_SIZE = 0.06
const MAX_SIZE = 0.42

export function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function defaultWellRegions(): WellRegions {
  const size = 0.2
  const columns = 3
  const rows = 2
  const gapX = (1 - size * columns) / (columns + 1)
  const gapY = (1 - size * rows) / (rows + 1)
  const regions = {} as WellRegions
  WELL_IDS.forEach((wellId, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    regions[wellId] = {
      x: gapX + column * (size + gapX),
      y: gapY + row * (size + gapY),
      w: size,
      h: size,
    }
  })
  return regions
}

export function copyRegions(regions: WellRegions): WellRegions {
  const copy = {} as WellRegions
  for (const wellId of WELL_IDS) {
    const region = regions[wellId]
    copy[wellId] = { x: region.x, y: region.y, w: region.w, h: region.h }
  }
  return copy
}

export function clampRegion(region: NormRect): NormRect {
  const w = clamp(region.w, MIN_SIZE, MAX_SIZE)
  const h = clamp(region.h, MIN_SIZE, MAX_SIZE)
  return {
    x: clamp(region.x, 0, 1 - w),
    y: clamp(region.y, 0, 1 - h),
    w,
    h,
  }
}

/** Move one well so its center sits on a normalized point, keeping its size. */
export function moveRegionCenter(
  regions: WellRegions,
  wellId: WellId,
  centerX: number,
  centerY: number,
): WellRegions {
  const current = regions[wellId]
  return {
    ...regions,
    [wellId]: clampRegion({
      x: centerX - current.w / 2,
      y: centerY - current.h / 2,
      w: current.w,
      h: current.h,
    }),
  }
}

export function nudgeRegion(
  regions: WellRegions,
  wellId: WellId,
  dx: number,
  dy: number,
): WellRegions {
  const current = regions[wellId]
  return {
    ...regions,
    [wellId]: clampRegion({
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    }),
  }
}

/** Resize every well around its current center. */
export function resizeAllRegions(regions: WellRegions, size: number): WellRegions {
  const next = {} as WellRegions
  for (const wellId of WELL_IDS) {
    const current = regions[wellId]
    const centerX = current.x + current.w / 2
    const centerY = current.y + current.h / 2
    next[wellId] = clampRegion({
      x: centerX - size / 2,
      y: centerY - size / 2,
      w: size,
      h: size,
    })
  }
  return next
}

/**
 * Visible media box inside a container using object-fit: contain.
 * Returns null when either side has no size yet.
 */
export function containContentRect(
  containerW: number,
  containerH: number,
  mediaW: number,
  mediaH: number,
): PixelRect | null {
  if (containerW <= 0 || containerH <= 0 || mediaW <= 0 || mediaH <= 0) return null
  const scale = Math.min(containerW / mediaW, containerH / mediaH)
  const w = mediaW * scale
  const h = mediaH * scale
  return {
    x: (containerW - w) / 2,
    y: (containerH - h) / 2,
    w,
    h,
  }
}

export function normalizedToContent(region: NormRect, content: PixelRect): PixelRect {
  return {
    x: content.x + region.x * content.w,
    y: content.y + region.y * content.h,
    w: region.w * content.w,
    h: region.h * content.h,
  }
}

/** Map a point in container pixels into media fractions. Null when outside the picture. */
export function contentPointToNormalized(
  x: number,
  y: number,
  content: PixelRect,
): { x: number; y: number } | null {
  if (content.w <= 0 || content.h <= 0) return null
  const nx = (x - content.x) / content.w
  const ny = (y - content.y) / content.h
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null
  return { x: nx, y: ny }
}
