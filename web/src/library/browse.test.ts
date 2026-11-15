import { describe, expect, it } from 'vitest'
import { countLabel, listQuery, publishedLabel, stepLabel, versionLabel } from './browse.ts'

describe('library browsing', () => {
  it('sends a bounded title query without implying an empty search', () => {
    expect(listQuery({ q: '  Dye ', sort: 'oldest', offset: 20 })).toBe('q=Dye&sort=oldest&limit=20&offset=20')
    expect(listQuery({ q: '   ', sort: 'newest', offset: 0 })).toBe('sort=newest&limit=20&offset=0')
  })

  it('labels a returned total separately from the rows on this page', () => {
    expect(countLabel(2, 5, false)).toBe('Showing 2 of 5 publications')
    expect(countLabel(1, 2, true)).toBe('Showing 1 of 2 matching publications')
    expect(countLabel(0, 0, true)).toBe('No matching publications')
    expect(countLabel(3, null, false)).toBe('3 shown')
  })

  it('does not invent a version, step count, or date', () => {
    expect(versionLabel(2)).toBe('Version 2')
    expect(versionLabel(undefined)).toBe('Version not recorded')
    expect(stepLabel(1)).toBe('1 step')
    expect(stepLabel(undefined)).toBe('Steps not recorded')
    expect(publishedLabel(undefined)).toBe('Date not recorded')
    expect(publishedLabel('not-a-date')).toBe('not-a-date')
  })
})
