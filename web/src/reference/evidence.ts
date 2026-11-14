import { validRegion, type Measurement, type Region } from './measure.ts'

export interface Evidence {
  id: string
  clipId: string
  title: string
  source: string
  time: number
  region: Region
  result: Measurement
  image: string
  capturedAt: string
}

export function methodVersionLabel(result: { analysisVersion?: string }): string {
  return result.analysisVersion ? result.analysisVersion : 'method version not recorded'
}

export function readEvidenceList(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Evidence => {
    if (!item || typeof item !== 'object') return false
    const record = item as Evidence
    const version = record.result?.analysisVersion
    return typeof record.id === 'string'
      && typeof record.clipId === 'string'
      && typeof record.title === 'string'
      && typeof record.source === 'string'
      && Number.isFinite(record.time)
      && validRegion(record.region)
      && !!record.result
      && ['accepted', 'rejected'].includes(record.result.quality)
      && (record.result.dispersion === null || Number.isFinite(record.result.dispersion))
      && (version === undefined || typeof version === 'string')
      && typeof record.image === 'string'
      && record.image.startsWith('data:image/jpeg;base64,')
  }).slice(-24)
}
