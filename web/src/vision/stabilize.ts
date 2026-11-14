import { initialWellStates } from '../shared/protocol.ts'
import {
  WELL_IDS,
  type ObservationDraft,
  type WellId,
  type WellReading,
  type WellState,
} from '../shared/types.ts'

/**
 * Commits a well only after the same raw reading repeats.
 * One odd frame, including a hand or pipette crossing the well, does not change the stable state.
 */
export class ReadingStabilizer {
  private readonly required: number
  private committed: Record<WellId, WellState>
  private pending: Record<WellId, { state: WellState; count: number }>

  constructor(required: number) {
    if (required < 1) throw new Error('stable frame count must be at least 1')
    this.required = required
    this.committed = initialWellStates()
    this.pending = pendingUnknown()
  }

  reset(): void {
    this.committed = initialWellStates()
    this.pending = pendingUnknown()
  }

  push(raw: Readonly<Record<WellId, WellState>>): {
    states: Record<WellId, WellState>
    changed: boolean
  } {
    let changed = false
    for (const wellId of WELL_IDS) {
      const next = raw[wellId]
      const slot = this.pending[wellId]
      if (slot.state === next) slot.count += 1
      else {
        slot.state = next
        slot.count = 1
      }
      if (slot.count >= this.required && this.committed[wellId] !== next) {
        this.committed[wellId] = next
        changed = true
      }
    }
    return { states: { ...this.committed }, changed }
  }

  snapshot(): Record<WellId, WellState> {
    return { ...this.committed }
  }
}

/**
 * Emits one six-well snapshot when the stable reading changes.
 * A backwards clock blocks the rest of the run so a seek or replay cannot reorder events.
 * Two changes in the same millisecond wait until the clock moves forward.
 */
export class ObservationEmitter {
  private lastElapsed = -1
  private lastSignature = ''
  private blockedReason: string | null = null
  private held: { wells: Record<WellId, WellState>; signature: string } | null = null

  get blocked(): string | null {
    return this.blockedReason
  }

  block(reason: string): void {
    this.blockedReason = reason
    this.held = null
  }

  reset(): void {
    this.lastElapsed = -1
    this.lastSignature = ''
    this.blockedReason = null
    this.held = null
  }

  /** Remember a snapshot without emitting it. The next different stable reading can emit. */
  arm(wells: Readonly<Record<WellId, WellState>>): void {
    this.lastSignature = signatureOf(wells)
    this.held = null
  }

  consider(
    elapsedMs: number,
    wells: Readonly<Record<WellId, WellState>>,
  ): ObservationDraft | null {
    if (this.blockedReason) return null
    if (!Number.isInteger(elapsedMs) || elapsedMs < 0) return null
    if (this.lastElapsed >= 0 && elapsedMs < this.lastElapsed) {
      this.block('The run clock moved backwards. Start a new run so events stay in order.')
      return null
    }

    const signature = signatureOf(wells)
    if (signature !== this.lastSignature) {
      this.held = { wells: copyStates(wells), signature }
    }
    if (!this.held) return null
    if (elapsedMs <= this.lastElapsed) return null

    const draft: ObservationDraft = {
      elapsedMs,
      wells: readingsOf(this.held.wells),
    }
    this.lastElapsed = elapsedMs
    this.lastSignature = this.held.signature
    this.held = null
    return draft
  }
}

export function signatureOf(wells: Readonly<Record<WellId, WellState>>): string {
  return WELL_IDS.map((wellId) => wells[wellId]).join(',')
}

export function readingsOf(wells: Readonly<Record<WellId, WellState>>): WellReading[] {
  return WELL_IDS.map((wellId) => ({ wellId, state: wells[wellId] }))
}

function copyStates(wells: Readonly<Record<WellId, WellState>>): Record<WellId, WellState> {
  const copy = {} as Record<WellId, WellState>
  for (const wellId of WELL_IDS) copy[wellId] = wells[wellId]
  return copy
}

function pendingUnknown(): Record<WellId, { state: WellState; count: number }> {
  const pending = {} as Record<WellId, { state: WellState; count: number }>
  for (const wellId of WELL_IDS) pending[wellId] = { state: 'unknown', count: 0 }
  return pending
}
