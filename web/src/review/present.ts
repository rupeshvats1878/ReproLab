import { foldWellStates } from '../shared/protocol.ts'
import type { OmissionAlert, RunRecord, WellId, WellState } from '../shared/types.ts'

export function readingLabel(state: WellState): string {
  if (state === 'unknown') {
    return 'Camera did not confirm this well. Verify it; do not treat it as empty.'
  }
  if (state === 'empty') return 'Visibly empty in the supporting observation.'
  return 'Observed filled.'
}

export function groupAlerts(alerts: readonly OmissionAlert[]): OmissionAlert[][] {
  const groups: OmissionAlert[][] = []
  const bySource = new Map<string, OmissionAlert[]>()
  for (const alert of alerts) {
    const existing = bySource.get(alert.sourceObservationId)
    if (existing) {
      existing.push(alert)
      continue
    }
    const group = [alert]
    bySource.set(alert.sourceObservationId, group)
    groups.push(group)
  }
  return groups
}

export function laterObservedFill(
  record: Pick<RunRecord, 'observations'>,
  alert: OmissionAlert,
): { observationId: string; elapsedMs: number } | null {
  const later = record.observations.find(
    (observation) =>
      observation.elapsedMs > alert.raisedAtElapsedMs &&
      observation.wells.some((reading) => reading.wellId === alert.wellId && reading.state === 'filled'),
  )
  if (!later) return null
  return { observationId: later.id, elapsedMs: later.elapsedMs }
}

export function unconfirmedWells(record: RunRecord): { wellId: WellId; state: WellState }[] {
  const states = foldWellStates(record.observations)
  return record.metadata.protocolOrder
    .filter((wellId) => states[wellId] !== 'filled')
    .map((wellId) => ({ wellId, state: states[wellId] }))
}
