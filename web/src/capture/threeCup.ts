import { watchMomentMs } from '../vision/alignment.ts'

export const SIX_WELL_PROCEDURE_ID = 'six-well-colored-water'
export const THREE_CUP_PROCEDURE_ID = 'three-cup-capture'
export const ANNOTATION_SCHEMA_VERSION = 1

export const THREE_CUP_CUPS = ['RED', 'GREEN', 'BLUE'] as const

export const CAPTURE_PROTOCOL_IDS = ['red-blue-then-green-red', 'blue-red-then-green-blue'] as const
export type CaptureProtocolId = (typeof CAPTURE_PROTOCOL_IDS)[number]
export const DEFAULT_CAPTURE_PROTOCOL_ID: CaptureProtocolId = 'red-blue-then-green-red'

export interface CaptureProtocol {
  id: CaptureProtocolId
  title: string
  lines: readonly string[]
  transfers: readonly (readonly [string, string])[]
}

export const CAPTURE_PROTOCOLS: readonly CaptureProtocol[] = [
  {
    id: 'red-blue-then-green-red',
    title: 'RED → BLUE, then GREEN → RED',
    lines: [
      'RED and BLUE should look uniformly mixed. GREEN will have visible streaks.',
      'Expected transfers: RED → BLUE, then GREEN → RED.',
    ],
    transfers: [
      ['RED', 'BLUE'],
      ['GREEN', 'RED'],
    ],
  },
  {
    id: 'blue-red-then-green-blue',
    title: 'BLUE → RED, then GREEN → BLUE',
    lines: [
      'First transfer: BLUE → RED.',
      'Second transfer: GREEN → BLUE.',
    ],
    transfers: [
      ['BLUE', 'RED'],
      ['GREEN', 'BLUE'],
    ],
  },
]

/** Setup note for the first procedure only. It is not an approved step and must not be sent to an observation model. */
export const THREE_CUP_DEMO_PLAN = 'This take’s plan is to perform GREEN → BLUE for the second transfer.'

export function captureProtocol(id: string | null | undefined): CaptureProtocol {
  return CAPTURE_PROTOCOLS.find((item) => item.id === id) ?? CAPTURE_PROTOCOLS[0]
}

export const THREE_CUP_EXPECTED = captureProtocol(DEFAULT_CAPTURE_PROTOCOL_ID).lines

export const CAPTURE_MARKERS = [
  { id: 'green_streaks', label: 'Visible streaks in GREEN', cups: ['GREEN'] },
  { id: 'transfer_red_to_blue', label: 'RED → BLUE transfer', cups: ['RED', 'BLUE'] },
  { id: 'transfer_blue_to_red', label: 'BLUE → RED transfer', cups: ['BLUE', 'RED'] },
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
  stepNumber: number | null
}

const TRANSFER_PAIRS: Record<string, readonly [string, string]> = {
  transfer_red_to_blue: ['RED', 'BLUE'],
  transfer_blue_to_red: ['BLUE', 'RED'],
  transfer_green_to_red: ['GREEN', 'RED'],
  transfer_green_to_blue: ['GREEN', 'BLUE'],
}

export const SHARED_PUBLICATION_LIMIT_BYTES = 80 * 1024 * 1024

export function localReviewNotice(name: string, bytes: number): string {
  if (bytes > SHARED_PUBLICATION_LIMIT_BYTES) {
    return `${name} is larger than the 80 MiB shared-library limit. The original file stays where it is. Review it here, publish the notes without the video, or use a smaller file.`
  }
  return `${name} stays on this computer. Nothing is uploaded from this page.`
}

/** Compares a person report with one frozen procedure. A match does not complete a step or claim a camera result. */
export function compareHumanMarker(
  marker: CaptureMarkerId,
  protocolId: CaptureProtocolId = DEFAULT_CAPTURE_PROTOCOL_ID,
): MarkerComparison {
  const protocol = captureProtocol(protocolId)
  const defined = markerDefinition(marker)
  const expectedStep = protocol.lines.join(' ')
  if (!defined || marker === 'green_streaks') {
    return {
      reported: defined?.label ?? marker,
      source: 'human',
      expectedStep,
      relation: 'appearance report',
      review: 'A person reported appearance. No camera measurement is attached, and no step is completed.',
      stepNumber: null,
    }
  }
  const pair = TRANSFER_PAIRS[marker]
  const stepNumber = protocol.transfers.findIndex((step) => step[0] === pair[0] && step[1] === pair[1])
  if (stepNumber >= 0) {
    return {
      reported: defined.label,
      source: 'human',
      expectedStep,
      relation: 'matches the expected transfer',
      review: `The report names step ${stepNumber + 1}. It does not complete that step, and it is not a detected pour.`,
      stepNumber: stepNumber + 1,
    }
  }
  return {
    reported: defined.label,
    source: 'human',
    expectedStep,
    relation: 'differs from the expected transfer',
    review: 'This report is outside the expected steps. It stays in the evidence list and does not complete a step.',
    stepNumber: null,
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
  captureProtocolId?: CaptureProtocolId
}) {
  const protocol = captureProtocol(args.captureProtocolId)
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    kind: 'annotation',
    note: 'Annotation data recorded by a person. Not a Laya training dataset and not a camera judgment.',
    procedureId: THREE_CUP_PROCEDURE_ID,
    captureProtocolId: protocol.id,
    sessionId: args.sessionId,
    cups: THREE_CUP_CUPS.map((id) => ({
      id,
      identity: 'physical label',
      expectedAppearance: id === 'GREEN' ? 'visible streaks' : 'uniformly mixed',
    })),
    expectedProcedure: [...protocol.lines],
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
