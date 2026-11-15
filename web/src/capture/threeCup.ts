import { watchMomentMs } from '../vision/alignment.ts'

export const SIX_WELL_PROCEDURE_ID = 'six-well-colored-water'
export const THREE_CUP_PROCEDURE_ID = 'three-cup-capture'
export const ANNOTATION_SCHEMA_VERSION = 1

export const THREE_CUP_CUPS = ['RED', 'GREEN', 'BLUE'] as const

export const THREE_CUP_EXPECTED = [
  'RED and BLUE should look uniformly mixed. GREEN will have visible streaks.',
  'Expected transfers: RED → BLUE, then GREEN → RED.',
] as const

/** Operator setup only. Keep this out of the approved procedure and out of model requests. */
export const THREE_CUP_DEMO_PLAN = 'This take’s plan is to perform GREEN → BLUE for the second transfer.'

export const CAPTURE_MARKERS = [
  { id: 'green_streaks', label: 'Visible streaks in GREEN', cups: ['GREEN'] },
  { id: 'transfer_red_to_blue', label: 'RED → BLUE transfer', cups: ['RED', 'BLUE'] },
  { id: 'transfer_green_to_red', label: 'GREEN → RED transfer', cups: ['GREEN', 'RED'] },
  { id: 'transfer_green_to_blue', label: 'GREEN → BLUE transfer', cups: ['GREEN', 'BLUE'] },
] as const

export type CaptureMarkerId = (typeof CAPTURE_MARKERS)[number]['id']

export interface CaptureMarkerRecord {
  id: string
  marker: CaptureMarkerId
  observationTimestamp: number
  cups: string[]
  label: string
}

export function markerDefinition(id: string) {
  return CAPTURE_MARKERS.find((item) => item.id === id) ?? null
}

export type MarkerRelation = 'appearance report' | 'matches the expected transfer' | 'differs from the expected transfer'

export interface MarkerComparison {
  reported: string
  source: 'human'
  expectedStep: string
  relation: MarkerRelation
  review: string
}

/** Compares a person report with the written procedure. It does not complete a step or claim a camera result. */
export function compareHumanMarker(marker: CaptureMarkerId): MarkerComparison {
  const defined = markerDefinition(marker)
  if (!defined) {
    return {
      reported: marker,
      source: 'human',
      expectedStep: 'The expected transfers are RED → BLUE, then GREEN → RED.',
      relation: 'appearance report',
      review: 'This report is not a camera measurement.',
    }
  }
  if (marker === 'green_streaks') {
    return {
      reported: defined.label,
      source: 'human',
      expectedStep: 'GREEN is expected to show visible streaks. RED and BLUE are expected to look uniformly mixed.',
      relation: 'appearance report',
      review: 'A person reported streaks. No camera measurement is attached.',
    }
  }
  if (marker === 'transfer_red_to_blue') {
    return {
      reported: defined.label,
      source: 'human',
      expectedStep: 'The first expected transfer is RED → BLUE.',
      relation: 'matches the expected transfer',
      review: 'The report names the same cups as the first expected transfer. The camera has not verified it.',
    }
  }
  if (marker === 'transfer_green_to_red') {
    return {
      reported: defined.label,
      source: 'human',
      expectedStep: 'The second expected transfer is GREEN → RED.',
      relation: 'matches the expected transfer',
      review: 'The report names the same cups as the second expected transfer. The camera has not verified it.',
    }
  }
  return {
    reported: defined.label,
    source: 'human',
    expectedStep: 'The second expected transfer is GREEN → RED.',
    relation: 'differs from the expected transfer',
    review: 'The report names a different destination from the expected step. It is still a person report, not a detected pour.',
  }
}

/** Recording position in seconds, using the same offset as the annotation export. Null when the moment is outside the file. */
export function recordingSeekSeconds(
  observationTimestamp: number,
  runStartOffsetMs: number,
  durationMs?: number | null,
): number | null {
  const mediaMs = watchMomentMs(observationTimestamp, runStartOffsetMs, durationMs)
  return mediaMs == null ? null : mediaMs / 1000
}

/** Annotation export for a person reviewing the take. This is not a training set. */
export function annotationDocument(args: {
  sessionId: string
  markers: CaptureMarkerRecord[]
  runStartOffsetMs: number
  durationMs?: number | null
  mediaId?: string | null
}) {
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    kind: 'annotation',
    note: 'Annotation data recorded by a person. Not a Laya training dataset and not a camera judgment.',
    procedureId: THREE_CUP_PROCEDURE_ID,
    sessionId: args.sessionId,
    cups: THREE_CUP_CUPS.map((id) => ({
      id,
      identity: 'physical label',
      expectedAppearance: id === 'GREEN' ? 'visible streaks' : 'uniformly mixed',
    })),
    expectedProcedure: [...THREE_CUP_EXPECTED],
    recording: {
      mediaId: args.mediaId ?? null,
      runStartOffsetMs: args.runStartOffsetMs,
      durationMs: args.durationMs ?? null,
    },
    markers: args.markers.map((marker) => ({
      id: marker.id,
      provenance: 'human',
      marker: marker.marker,
      label: marker.label,
      cups: marker.cups,
      observationTimestamp: marker.observationTimestamp,
      recordingTimestampMs: marker.observationTimestamp + args.runStartOffsetMs,
    })),
  }
}
