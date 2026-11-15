export const SIX_WELL_PROCEDURE_ID = 'six-well-colored-water'
export const THREE_CUP_PROCEDURE_ID = 'three-cup-capture'
export const ANNOTATION_SCHEMA_VERSION = 1

export const THREE_CUP_CUPS = ['RED', 'GREEN', 'BLUE'] as const

export const THREE_CUP_EXPECTED = [
  'RED and BLUE should look uniformly mixed. GREEN will have visible streaks.',
  'Expected transfers: RED → BLUE, then GREEN → RED.',
  'This take deliberately uses GREEN → BLUE for the second transfer.',
] as const

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
