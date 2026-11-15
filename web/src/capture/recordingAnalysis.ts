/** Local saved-analysis review. No inference, persistence, or automatic step completion. */
export const RECORDING_ANALYSIS_SCHEMA = 'three-cup-recording-analysis/v0.1'
type ObjectValue = Record<string, unknown>
export interface RecordingEvent {
  id: string
  source: string
  destination: string
  startMs: number
  endMs: number
  evidence: number[]
  uncertain: boolean
  humanConfirmed: boolean
}
export interface RecordingAnalysis {
  sessionId: string
  videoId: string
  durationMs: number
  sizeBytes: number
  sourceSha256: string | null
  events: RecordingEvent[]
  appearanceCount: number
  warnings: string[]
  raw: unknown
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as ObjectValue
}
function time(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid recording timestamp.')
  return value as number
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Missing or invalid identity.')
  return value
}
function cup(value: unknown): string {
  if (value === null || value === 'unknown') return 'unknown'
  if (!['RED', 'GREEN', 'BLUE'].includes(value as string)) throw new Error('Invalid physical cup identity.')
  return value as string
}
export function parseRecordingAnalysis(value: unknown): RecordingAnalysis {
  const raw = object(value)
  if (raw.schemaVersion !== RECORDING_ANALYSIS_SCHEMA) throw new Error('Unsupported recording-analysis schema.')
  const recording = object(raw.recording)
  const durationMs = time(recording.durationMs)
  const sizeBytes = time(recording.sizeBytes)
  const sourceSha256 = recording.sha256 == null ? null : String(recording.sha256).toLowerCase()
  if (sourceSha256 !== null && !/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error('Invalid recording source hash.')
  if (!durationMs || durationMs > 86_400_000 || !sizeBytes) throw new Error('Invalid recording metadata.')
  if (!Array.isArray(raw.segments) || !raw.segments.length) throw new Error('Missing analysis windows.')
  const warnings: string[] = []
  if (raw.error) warnings.push('The imported analysis reports an error; retain it for review.')
  if (raw.coverageComplete === false) warnings.push('The producer reports incomplete coverage.')
  const windows = raw.segments.map((value) => {
    const segment = object(value)
    const start = time(segment.sourceOffsetMs), duration = time(segment.durationMs), end = time(segment.endMs)
    if (!duration || duration > 60_000 || start + duration !== end || end > durationMs) throw new Error('Invalid analysis window.')
    if (segment.error || segment.observationStatus === 'unavailable') warnings.push('An analysis window failed; coverage is incomplete.')
    if (!['observed', 'unclear', 'no_transfer', 'unavailable'].includes(segment.observationStatus as string)) throw new Error('Invalid window status.')
    return { start, end }
  })
  let coveredEnd = 0
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    if (window.start > coveredEnd) warnings.push('Analysis windows leave a gap.')
    coveredEnd = Math.max(coveredEnd, window.end)
  }
  if (coveredEnd < durationMs) warnings.push('Analysis does not cover the end of the recording.')
  const timeline = object(raw.timeline)
  if (!Array.isArray(timeline.events) || !Array.isArray(timeline.appearances)) throw new Error('Missing timeline arrays.')
  const identifiers = new Set<string>()
  const events = timeline.events.map((value): RecordingEvent => {
    const event = object(value), eventId = id(event.eventId)
    if (identifiers.has(eventId)) throw new Error('Duplicate event identity.')
    identifiers.add(eventId)
    const startMs = time(event.eventStartMs), endMs = time(event.eventEndMs)
    if (startMs >= endMs || endMs > durationMs) throw new Error('Event is outside the recording or has no duration.')
    if (!Array.isArray(event.evidenceTimestampsMs)) throw new Error('Missing event evidence array.')
    const evidence = event.evidenceTimestampsMs.map(time)
    if (evidence.some((stamp) => stamp < startMs || stamp > endMs)) throw new Error('Evidence is outside its event.')
    if (event.needsHumanVerification !== true) throw new Error('Human-review requirement must be retained.')
    if (event.humanConfirmed !== undefined && typeof event.humanConfirmed !== 'boolean') throw new Error('Invalid human-confirmation flag.')
    if (!['observed', 'unclear'].includes(event.observationStatus as string)) throw new Error('Invalid event status.')
    const source = cup(event.sourceCupId), destination = cup(event.destinationCupId)
    if (source !== 'unknown' && source === destination) throw new Error('Transfer names the same cup twice.')
    const indexes = event.segmentIndexes ?? (event.segmentIndex === undefined ? [] : [event.segmentIndex])
    if (!Array.isArray(indexes) || indexes.some((index) => !Number.isInteger(index) || !windows[index as number])) throw new Error('Invalid source window reference.')
    if (indexes.length && !indexes.some((index) => startMs >= windows[index as number].start && endMs <= windows[index as number].end)) throw new Error('Event does not fit its referenced window.')
    return { id: eventId, source, destination, startMs, endMs, evidence,
      uncertain: source === 'unknown' || destination === 'unknown' || event.observationStatus === 'unclear' || !evidence.length || event.truncated === true,
      humanConfirmed: event.humanConfirmed === true }
  }).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  for (const value of timeline.appearances) {
    const appearance = object(value)
    cup(appearance.cupId)
    if (!['visually_uniform', 'visibly_streaked', 'unclear'].includes(appearance.label as string)) throw new Error('Invalid appearance label.')
    if (!Array.isArray(appearance.evidenceTimestampsMs) || appearance.evidenceTimestampsMs.map(time).some((stamp) => stamp > durationMs)) throw new Error('Appearance evidence is outside the recording.')
  }
  warnings.push('Model hypotheses and supplied human confirmations remain separate. No protocol step is automatically completed.')
  return { sessionId: id(raw.sessionId), videoId: id(raw.videoId), durationMs, sizeBytes, sourceSha256, events,
    appearanceCount: timeline.appearances.length, warnings: [...new Set(warnings)], raw: structuredClone(value) }
}
export function recordingLinkError(analysis: RecordingAnalysis, bytes: number, durationMs: number, manifestHash: string | null, fileHash: string | null): string | null {
  if (analysis.sourceSha256 && manifestHash && analysis.sourceSha256 !== manifestHash.toLowerCase()) return 'The supplied manifest hash contradicts the analysis source hash.'
  if (analysis.sourceSha256 && fileHash?.toLowerCase() !== analysis.sourceSha256) return 'The selected recording does not match the analysis source hash.'
  if (bytes !== analysis.sizeBytes) return 'The recording size does not match this analysis.'
  // Demuxers can include different final audio/video tails; tolerate 250 ms, never shift events.
  if (!Number.isFinite(durationMs) || Math.abs(durationMs - analysis.durationMs) > 250) return 'The recording duration does not match this analysis (250 ms tolerance).'
  if (analysis.events.some((event) => event.endMs > durationMs)) return 'An event is outside the selected recording.'
  if (manifestHash && manifestHash.toLowerCase() !== fileHash?.toLowerCase()) return 'The recording does not match the supplied source hash.'
  return null
}
export function recordingComparisons(events: RecordingEvent[], approved: readonly (readonly [string, string])[]): string[] {
  const seen = new Set<number>()
  let highest = -1
  return events.map((event) => {
    if (event.uncertain) return 'Uncertain transfer · review required'
    const step = approved.findIndex(([source, destination]) => source === event.source && destination === event.destination)
    if (step < 0) return 'Possible extra transfer · potential deviation · review required'
    if (seen.has(step)) return 'Possible repeated / extra transfer · review required'
    seen.add(step)
    const outOfOrder = step < highest || approved.slice(0, step).some((_, index) => !seen.has(index))
    highest = Math.max(highest, step)
    return `${outOfOrder ? 'Possible wrong order · ' : ''}Pair matches approved step ${step + 1}${outOfOrder ? ' · possible order difference' : ''} · not automatically completed`
  })
}
