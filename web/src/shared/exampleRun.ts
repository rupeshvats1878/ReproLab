import { WELL_IDS, type Observation, type RunId, type RunRecord, type WellId } from './types.ts'

/**
 * SYNTHETIC fixtures for the three hackathon demos.
 * They are authored records, not camera output and not laboratory results.
 * Video bytes are intentionally absent (`available: false`).
 */

const AUTHORED_CLOCK = '2026-01-01T00:00:00.000Z'

function snapshot(
  runId: RunId,
  id: string,
  elapsedMs: number,
  filled: readonly WellId[],
): Observation {
  const filledSet = new Set<WellId>(filled)
  return {
    id,
    runId,
    elapsedMs,
    wells: WELL_IDS.map((wellId) => ({
      wellId,
      state: filledSet.has(wellId) ? 'filled' : 'empty',
    })),
  }
}

function plateWells(emptyWells: readonly WellId[]) {
  const empty = new Set<WellId>(emptyWells)
  return WELL_IDS.map((wellId) => {
    const state = empty.has(wellId) ? ('empty' as const) : ('filled' as const)
    return {
      wellId,
      state,
      matchesExpectedFilled: state === 'filled',
    }
  })
}

/** Demo 1. A2 is skipped, flagged, acknowledged, then filled and resolved. */
export const DEMO_SKIP_THEN_FILL: RunRecord = {
  metadata: {
    id: 'run_synthetic_skip_then_fill',
    source: 'synthetic',
    title: 'Demo 1 — skip, flag, then fill',
    startedAtIso: AUTHORED_CLOCK,
    protocolOrder: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    syntheticFixture: true,
    notes:
      'Synthetic fixture. A2 is skipped when A3 is filled, flagged, and later filled. No video bytes are included.',
  },
  observations: [
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_01', 1000, ['A1']),
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_02', 4000, ['A1', 'A3']),
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_03', 8000, [
      'A1',
      'A2',
      'A3',
    ]),
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_04', 11000, [
      'A1',
      'A2',
      'A3',
      'B1',
    ]),
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_05', 14000, [
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
    ]),
    snapshot('run_synthetic_skip_then_fill', 'obs_synthetic_skip_then_fill_06', 17000, [
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
      'B3',
    ]),
  ],
  humanEvents: [
    {
      id: 'evt_synthetic_skip_then_fill_ack',
      runId: 'run_synthetic_skip_then_fill',
      elapsedMs: 5000,
      kind: 'omission_acknowledged',
      wellId: 'A2',
      alertId: 'alert_synthetic_skip_then_fill_a2',
      note: 'Operator saw the A2 flag.',
      evidence: {
        mediaId: 'media_synthetic_skip_then_fill_camera',
        elapsedMs: 5000,
        windowMs: 1500,
        label: 'Acknowledgement',
      },
    },
    {
      id: 'evt_synthetic_skip_then_fill_resolve',
      runId: 'run_synthetic_skip_then_fill',
      elapsedMs: 8500,
      kind: 'omission_resolved',
      wellId: 'A2',
      alertId: 'alert_synthetic_skip_then_fill_a2',
      note: 'A2 was filled after the flag.',
      reportedState: 'filled',
      evidence: {
        mediaId: 'media_synthetic_skip_then_fill_camera',
        elapsedMs: 8500,
        windowMs: 2000,
        label: 'Resolution',
      },
    },
  ],
  alerts: [
    {
      id: 'alert_synthetic_skip_then_fill_a2',
      runId: 'run_synthetic_skip_then_fill',
      wellId: 'A2',
      protocolIndex: 1,
      raisedAtElapsedMs: 4000,
      status: 'resolved',
      sourceObservationId: 'obs_synthetic_skip_then_fill_02',
      acknowledgedEventId: 'evt_synthetic_skip_then_fill_ack',
      resolvedEventId: 'evt_synthetic_skip_then_fill_resolve',
    },
  ],
  media: [
    {
      mediaId: 'media_synthetic_skip_then_fill_camera',
      runId: 'run_synthetic_skip_then_fill',
      kind: 'camera_recording',
      available: false,
      mimeType: 'video/webm',
      runStartOffsetMs: 250,
      durationMs: 20000,
      label: 'Synthetic camera offsets only. No video file is stored.',
    },
    {
      mediaId: 'media_synthetic_skip_then_fill_plate',
      runId: 'run_synthetic_skip_then_fill',
      kind: 'final_plate_image',
      available: false,
      mimeType: 'image/png',
      runStartOffsetMs: 0,
      label: 'Synthetic final-image reference. No image file is stored.',
    },
  ],
  finalAssessment: {
    id: 'final_synthetic_skip_then_fill',
    runId: 'run_synthetic_skip_then_fill',
    elapsedMs: 17500,
    mediaId: 'media_synthetic_skip_then_fill_plate',
    wells: plateWells([]),
  },
}

/** Demo 2. B2 is skipped when B3 is filled and nobody resolves it. */
export const DEMO_SKIP_UNRESOLVED: RunRecord = {
  metadata: {
    id: 'run_synthetic_skip_unresolved',
    source: 'synthetic',
    title: 'Demo 2 — skip left unresolved',
    startedAtIso: AUTHORED_CLOCK,
    protocolOrder: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    syntheticFixture: true,
    notes:
      'Synthetic fixture. B2 stays empty after B3 is filled. The omission stays open. No video bytes are included.',
  },
  observations: [
    snapshot('run_synthetic_skip_unresolved', 'obs_synthetic_skip_unresolved_01', 1000, ['A1']),
    snapshot('run_synthetic_skip_unresolved', 'obs_synthetic_skip_unresolved_02', 3000, ['A1', 'A2']),
    snapshot('run_synthetic_skip_unresolved', 'obs_synthetic_skip_unresolved_03', 5000, [
      'A1',
      'A2',
      'A3',
    ]),
    snapshot('run_synthetic_skip_unresolved', 'obs_synthetic_skip_unresolved_04', 7000, [
      'A1',
      'A2',
      'A3',
      'B1',
    ]),
    snapshot('run_synthetic_skip_unresolved', 'obs_synthetic_skip_unresolved_05', 9000, [
      'A1',
      'A2',
      'A3',
      'B1',
      'B3',
    ]),
  ],
  humanEvents: [],
  alerts: [
    {
      id: 'alert_synthetic_skip_unresolved_b2',
      runId: 'run_synthetic_skip_unresolved',
      wellId: 'B2',
      protocolIndex: 4,
      raisedAtElapsedMs: 9000,
      status: 'open',
      sourceObservationId: 'obs_synthetic_skip_unresolved_05',
    },
  ],
  media: [
    {
      mediaId: 'media_synthetic_skip_unresolved_camera',
      runId: 'run_synthetic_skip_unresolved',
      kind: 'camera_recording',
      available: false,
      mimeType: 'video/webm',
      runStartOffsetMs: 0,
      durationMs: 12000,
      label: 'Synthetic camera offsets only. No video file is stored.',
    },
    {
      mediaId: 'media_synthetic_skip_unresolved_plate',
      runId: 'run_synthetic_skip_unresolved',
      kind: 'final_plate_image',
      available: false,
      mimeType: 'image/png',
      runStartOffsetMs: 0,
      label: 'Synthetic final-image reference. No image file is stored.',
    },
  ],
  finalAssessment: {
    id: 'final_synthetic_skip_unresolved',
    runId: 'run_synthetic_skip_unresolved',
    elapsedMs: 9500,
    mediaId: 'media_synthetic_skip_unresolved_plate',
    wells: plateWells(['B2']),
  },
}

/** Demo 3. Each well is filled in protocol order. No omission alerts. */
export const DEMO_COMPLETE: RunRecord = {
  metadata: {
    id: 'run_synthetic_complete',
    source: 'synthetic',
    title: 'Demo 3 — filled as planned',
    startedAtIso: AUTHORED_CLOCK,
    protocolOrder: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    syntheticFixture: true,
    notes:
      'Synthetic fixture. Every well is filled in order. No video bytes are included.',
  },
  observations: [
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_01', 1000, ['A1']),
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_02', 2000, ['A1', 'A2']),
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_03', 3000, ['A1', 'A2', 'A3']),
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_04', 4000, ['A1', 'A2', 'A3', 'B1']),
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_05', 5000, [
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
    ]),
    snapshot('run_synthetic_complete', 'obs_synthetic_complete_06', 6000, [
      'A1',
      'A2',
      'A3',
      'B1',
      'B2',
      'B3',
    ]),
  ],
  humanEvents: [],
  alerts: [],
  media: [
    {
      mediaId: 'media_synthetic_complete_camera',
      runId: 'run_synthetic_complete',
      kind: 'camera_recording',
      available: false,
      mimeType: 'video/webm',
      runStartOffsetMs: 100,
      durationMs: 8000,
      label: 'Synthetic camera offsets only. No video file is stored.',
    },
    {
      mediaId: 'media_synthetic_complete_plate',
      runId: 'run_synthetic_complete',
      kind: 'final_plate_image',
      available: false,
      mimeType: 'image/png',
      runStartOffsetMs: 0,
      label: 'Synthetic final-image reference. No image file is stored.',
    },
  ],
  finalAssessment: {
    id: 'final_synthetic_complete',
    runId: 'run_synthetic_complete',
    elapsedMs: 6500,
    mediaId: 'media_synthetic_complete_plate',
    wells: plateWells([]),
  },
}

/** Primary example. Same record as Demo 1. */
export const SYNTHETIC_EXAMPLE_RUN: RunRecord = DEMO_SKIP_THEN_FILL

export const SYNTHETIC_DEMO_RUNS: readonly RunRecord[] = [
  DEMO_SKIP_THEN_FILL,
  DEMO_SKIP_UNRESOLVED,
  DEMO_COMPLETE,
]
