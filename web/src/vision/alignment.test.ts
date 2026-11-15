import { describe, expect, it } from 'vitest'
import { mediaTimeMs, watchMomentMs } from './alignment.ts'

describe('recording alignment', () => {
  it('places run time zero at the stored recording offset', () => {
    expect(mediaTimeMs(0, 0)).toBe(0)
    expect(mediaTimeMs(3000, -2000)).toBe(1000)
    expect(mediaTimeMs(0, 500)).toBe(500)
  })

  it('offers a moment only inside the recording', () => {
    expect(watchMomentMs(3000, -2000, 4000)).toBe(1000)
    expect(watchMomentMs(100, -2000, 4000)).toBeNull()
    expect(watchMomentMs(7000, -2000, 4000)).toBeNull()
    expect(watchMomentMs(3000, -2000, null)).toBe(1000)
    expect(watchMomentMs(1.5, 0, 1000)).toBeNull()
  })
})
