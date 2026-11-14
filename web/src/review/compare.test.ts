import { describe, expect, it } from 'vitest'
import { SYNTHETIC_DEMO_RUNS } from '../shared/exampleRun.ts'
import { evidenceOffsetMs } from '../shared/protocol.ts'
import { compareRuns } from './compare.ts'
import { groupAlerts, laterObservedFill, readingLabel, unconfirmedWells } from './present.ts'

describe('review presentation', () => {
  it('groups alerts from the same observation and labels unknown separately from empty', () => {
    const [demo] = SYNTHETIC_DEMO_RUNS
    expect(demo).toBeDefined()
    expect(groupAlerts(demo!.alerts)).toHaveLength(1)
    expect(readingLabel('unknown')).toMatch(/verify/i)
    expect(readingLabel('empty')).toMatch(/visibly empty/i)
    expect(laterObservedFill(demo!, demo!.alerts[0]!)).toMatchObject({ elapsedMs: 8000 })
  })

  it('names wells that are still not filled when a run ends', () => {
    expect(unconfirmedWells(SYNTHETIC_DEMO_RUNS[1]!).map((well) => well.wellId)).toEqual(['B2'])
    expect(unconfirmedWells(SYNTHETIC_DEMO_RUNS[2]!)).toEqual([])
  })
})

describe('three-run comparison', () => {
  it('summarizes the three synthetic stories without claiming causation', () => {
    const report = compareRuns(SYNTHETIC_DEMO_RUNS)
    expect(report.runs.map((run) => run.unresolved)).toEqual([[], ['B2'], []])
    expect(report.runs[0]?.observedFilled).toContain('A2')
    expect(report.runs[0]?.evidence[0]?.mediaOffsetMs).toBe(evidenceOffsetMs(250, 5000))
    expect(report.runs[0]?.evidence.every((item) => item.covered === false)).toBe(true)
    expect(report.summary).toMatch(/unresolved B2 omission/)
    expect(report.summary).toMatch(/B2 appears empty/)
    expect(report.summary).toMatch(/No alerts does not mean no mistakes/)
    expect(report.caveat).toMatch(/do not prove causation/)
    expect(report.caveat).toMatch(/not an independent biological result/)
    expect(report.caveat).toMatch(/not automatic model learning/)
    expect(report.summary).not.toMatch(/AI-generated|model concluded/i)
  })
})
