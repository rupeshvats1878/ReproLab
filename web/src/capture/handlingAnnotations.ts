export interface HandlingAnnotation { timestampMs: number; message: string; source: 'team-annotation' }
export function handlingAnnotations(raw: unknown, durationMs: number): HandlingAnnotation[] {
  if (!raw || typeof raw !== 'object') return []
  const items = (raw as Record<string, unknown>).teamAnnotations
  if (!Array.isArray(items)) return []
  return items.filter((item): item is HandlingAnnotation => Boolean(item) &&
    item.source === 'team-annotation' && Number.isSafeInteger(item.timestampMs) &&
    item.timestampMs >= 0 && item.timestampMs <= durationMs &&
    typeof item.message === 'string' && item.message.trim().length > 0 && item.message.length <= 500
  ).sort((a, b) => a.timestampMs - b.timestampMs)
}
export function activeHandling(items: HandlingAnnotation[], timeMs: number): HandlingAnnotation | undefined {
  return items.findLast(item => item.timestampMs <= timeMs && timeMs < item.timestampMs + 4000)
}

export function sameModelAnalysis(a: unknown, b: unknown): boolean {
  function modelOnly(value: unknown) {
    if (!value || typeof value !== 'object') return value
    const { teamAnnotations: _annotations, ...model } = value as Record<string, unknown>
    return model
  }
  return JSON.stringify(modelOnly(a)) === JSON.stringify(modelOnly(b))
}
