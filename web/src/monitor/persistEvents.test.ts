import { describe, expect, it } from 'vitest'
import { PROTOCOL_ORDER, type WellId, type WellReading, type WellState } from '../shared/types.ts'
import {
  acknowledgeAlert,
  applyStableObservation,
  createLiveMonitor,
  reportMissedObservation,
  type FrameEvidence,
} from './liveDecisions.ts'
import { eventsFromDecision, observationEvent } from './persistEvents.ts'
import { createMonitorSaver } from './saveSession.ts'

function wells(states: Partial<Record<WellId, WellState>>): WellReading[] {
  return PROTOCOL_ORDER.map((wellId) => ({ wellId, state: states[wellId] ?? 'empty' }))
}

function evidence(elapsedMs: number, frameIndex: number): FrameEvidence {
  return {
    elapsedMs,
    frameIndex,
    frameDataUrl: 'data:image/jpeg;base64,not-stored',
    label: `frame ${frameIndex}`,
  }
}

describe('monitor event mapping', () => {
  it('stores the decision that is already on screen, including a later fill and a human report', () => {
    const monitor = createLiveMonitor('synthetic', 1)
    const first = applyStableObservation(
      monitor,
      { elapsedMs: 2640, wells: wells({ A1: 'filled', A2: 'empty', A3: 'filled' }) },
      evidence(2640, 11),
      wells({ A1: 'filled', A2: 'empty', A3: 'filled' }),
    )
    const alert = first.alerts[0]
    expect(alert?.wellId).toBe('A2')
    const opened = eventsFromDecision(monitor, first, null)
    const storedAlert = opened.find((event) => event.type === 'alert')
    expect(storedAlert).toMatchObject({
      id: alert?.id,
      observationTimestamp: 2640,
      wellId: 'A2',
      rule: alert?.rule,
      observedState: alert?.observedState,
      rawState: 'empty',
      stableState: 'empty',
      evidence: { mediaId: null, observationTimestamp: 2640, frameIndex: 11, label: 'frame 11' },
    })
    expect(JSON.stringify(opened)).not.toContain('data:image')

    const filled = applyStableObservation(
      first,
      { elapsedMs: 3520, wells: wells({ A1: 'filled', A2: 'filled', A3: 'filled' }) },
      evidence(3520, 15),
      wells({ A1: 'filled', A2: 'filled', A3: 'filled' }),
    )
    const correction = filled.timeline.find((entry) => entry.kind === 'correction')
    const update = eventsFromDecision(first, filled, null).find((event) => event.type === 'alert_update')
    expect(update).toMatchObject({
      id: correction?.id,
      alertId: alert?.id,
      observationTimestamp: 3520,
      rule: correction?.rule,
      observedState: correction?.observedState,
      stableState: 'filled',
    })
    expect(filled.alerts[0]?.observedState).toBe(alert?.observedState)

    const reported = reportMissedObservation(
      filled,
      alert?.id ?? '',
      3520,
      evidence(3520, 15),
      'I saw A2 filled.',
      'filled',
    )
    const human = eventsFromDecision(filled, reported, null).find((event) => event.type === 'human_report')
    expect(human).toMatchObject({
      id: reported.timeline.at(-1)?.id,
      humanActionKind: 'correction_note',
      alertId: alert?.id,
      wellId: 'A2',
      humanNote: 'I saw A2 filled.',
      humanReportedState: 'filled',
    })

    const acknowledged = acknowledgeAlert(first, alert?.id ?? '', 2640, evidence(2640, 11), 'Acknowledged by a person.')
    const ack = eventsFromDecision(first, acknowledged, null)[0]
    expect(ack).toMatchObject({ humanActionKind: 'omission_acknowledged', wellId: 'A2' })
    expect(ack).not.toHaveProperty('humanReportedState')
  })

  it('retries the same body once and does not write it again', async () => {
    const calls: unknown[] = []
    let failObservation = true
    const saver = createMonitorSaver(() => {}, async (_path, body) => {
      calls.push(structuredClone(body))
      if (body && typeof body === 'object' && 'type' in body && body.type === 'observation' && failObservation) {
        failObservation = false
        throw new Error('The monitor store is not reachable. Nothing was saved.')
      }
    })
    const monitor = createLiveMonitor('synthetic', 1)
    const plate = wells({ A1: 'filled', A2: 'empty', A3: 'filled' })
    const next = applyStableObservation(monitor, { elapsedMs: 2640, wells: plate }, evidence(2640, 11), plate)
    saver.open({ sessionId: next.sessionId, sourceKind: 'synthetic', startedAtIso: '2026-11-15T00:00:00.000Z' })
    const observation = observationEvent('obs_11111111-1111-4111-8111-111111111111', 2640, plate, plate)
    saver.saveStep({ previous: monitor, next, observation })
    saver.saveStep({ previous: monitor, next, observation })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const observations = calls.filter((body) => body && typeof body === 'object' && 'type' in body && body.type === 'observation')
    expect(observations).toHaveLength(2)
    expect(observations[0]).toEqual(observations[1])
    const alerts = calls.filter((body) => body && typeof body === 'object' && 'type' in body && body.type === 'alert')
    expect(alerts).toHaveLength(1)
  })
})
