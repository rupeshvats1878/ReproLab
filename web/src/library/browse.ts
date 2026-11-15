export const PAGE_SIZE = 20

export function listQuery(input: { q: string; sort: 'newest' | 'oldest'; offset: number }): string {
  const params = new URLSearchParams()
  const q = input.q.trim()
  if (q) params.set('q', q)
  params.set('sort', input.sort)
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(Math.max(0, input.offset)))
  return params.toString()
}

export function countLabel(shown: number, total: number | null, searching: boolean): string {
  if (total == null) return shown === 1 ? '1 shown' : `${shown} shown`
  const subject = searching ? 'matching publications' : 'publications'
  if (total === 0) return searching ? 'No matching publications' : 'No publications'
  return `Showing ${shown} of ${total} ${subject}`
}

export function versionLabel(value: number | undefined): string {
  return typeof value === 'number' ? `Version ${value}` : 'Version not recorded'
}

export function stepLabel(count: number | undefined): string {
  if (typeof count !== 'number') return 'Steps not recorded'
  return count === 1 ? '1 step' : `${count} steps`
}

export function publishedLabel(value: string | undefined): string {
  if (!value) return 'Date not recorded'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString()
}
