import { describe, expect, it } from 'vitest'
import { WELL_IDS } from '../shared/types.ts'
import {
  containContentRect,
  contentPointToNormalized,
  defaultWellRegions,
  moveRegionCenter,
  normalizedToContent,
  nudgeRegion,
  resizeAllRegions,
} from './geometry.ts'

describe('well registration geometry', () => {
  it('places six non-overlapping wells inside the frame', () => {
    const regions = defaultWellRegions()
    expect(Object.keys(regions)).toEqual([...WELL_IDS])
    for (const wellId of WELL_IDS) {
      const region = regions[wellId]
      expect(region.x).toBeGreaterThanOrEqual(0)
      expect(region.y).toBeGreaterThanOrEqual(0)
      expect(region.x + region.w).toBeLessThanOrEqual(1)
      expect(region.y + region.h).toBeLessThanOrEqual(1)
    }
    expect(regions.A2.x).toBeGreaterThan(regions.A1.x + regions.A1.w)
    expect(regions.B1.y).toBeGreaterThan(regions.A1.y + regions.A1.h)
  })

  it('maps normalized wells through object-fit contain, including letterboxing', () => {
    const content = containContentRect(640, 480, 320, 180)
    expect(content).toEqual({ x: 0, y: 60, w: 640, h: 360 })
    const display = normalizedToContent({ x: 0, y: 0, w: 0.5, h: 0.5 }, content!)
    expect(display).toEqual({ x: 0, y: 60, w: 320, h: 180 })
    expect(contentPointToNormalized(160, 150, content!)).toEqual({ x: 0.25, y: 0.25 })
    expect(contentPointToNormalized(10, 10, content!)).toBeNull()
  })

  it('keeps the same media point when the container size changes', () => {
    const region = { x: 0.25, y: 0.25, w: 0.2, h: 0.2 }
    const small = containContentRect(640, 480, 320, 180)
    const large = containContentRect(1280, 960, 320, 180)
    const smallBox = normalizedToContent(region, small!)
    const largeBox = normalizedToContent(region, large!)
    expect(largeBox.w).toBeCloseTo(smallBox.w * 2)
    expect(largeBox.h).toBeCloseTo(smallBox.h * 2)
    const fromSmall = contentPointToNormalized(smallBox.x + smallBox.w / 2, smallBox.y + smallBox.h / 2, small!)
    const fromLarge = contentPointToNormalized(largeBox.x + largeBox.w / 2, largeBox.y + largeBox.h / 2, large!)
    expect(fromSmall).toEqual(fromLarge)
  })

  it('moves, nudges, and resizes without leaving the frame', () => {
    const regions = defaultWellRegions()
    const moved = moveRegionCenter(regions, 'A1', 0.01, 0.01)
    expect(moved.A1.x).toBe(0)
    expect(moved.A1.y).toBe(0)
    expect(moved.A2).toEqual(regions.A2)

    const nudged = nudgeRegion(regions, 'B3', 1, 1)
    expect(nudged.B3.x + nudged.B3.w).toBeLessThanOrEqual(1)
    expect(nudged.B3.y + nudged.B3.h).toBeLessThanOrEqual(1)

    const resized = resizeAllRegions(regions, 0.1)
    expect(resized.A2.w).toBeCloseTo(0.1)
    const oldCenter = regions.A2.x + regions.A2.w / 2
    const newCenter = resized.A2.x + resized.A2.w / 2
    expect(newCenter).toBeCloseTo(oldCenter)
  })
})
