import { ANALYSIS_METHOD, measure, validRegion, type Measurement, type Region } from './measure.ts'

export const MAX_JPEG_BYTES = 262144

export interface StoredMeasurement {
  metric: 'spatial_color_dispersion'
  value: number | null
  quality: 'accepted' | 'rejected'
  reason: string | null
  analysisVersion: typeof ANALYSIS_METHOD
}

export interface FrozenCapture {
  imageDataUrl: string
  imageBase64: string
  byteLength: number
  videoTimeSec: number
  crop: Region
  measurement: StoredMeasurement
  localResult: Measurement
}

export function jpegByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

export function capturePausedFrame(player: HTMLVideoElement, region: Region): FrozenCapture {
  if (player.readyState < 2 || player.seeking || !player.paused || !validRegion(region)) {
    throw new Error('Pause the video, wait for seeking to finish, and choose a crop inside the image.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 180
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to read the frame.')
  context.drawImage(
    player,
    player.videoWidth * region.x / 100,
    player.videoHeight * region.y / 100,
    player.videoWidth * region.width / 100,
    player.videoHeight * region.height / 100,
    0,
    0,
    240,
    180,
  )
  const measured = measure(context.getImageData(0, 0, 240, 180).data, 240, 180)
  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.75)
  const imageBase64 = imageDataUrl.slice(imageDataUrl.indexOf(',') + 1)
  const byteLength = jpegByteLength(imageBase64)
  if (byteLength > MAX_JPEG_BYTES) {
    throw new Error('The JPEG is larger than 256 KiB. Capture a smaller frame before attaching it.')
  }
  if (measured.quality === 'accepted' && measured.dispersion == null) {
    throw new Error('The measurement did not produce a dispersion value.')
  }
  const rejected = measured.quality === 'rejected'
  return {
    imageDataUrl,
    imageBase64,
    byteLength,
    videoTimeSec: player.currentTime,
    crop: { ...region },
    measurement: {
      metric: 'spatial_color_dispersion',
      value: rejected ? null : measured.dispersion,
      quality: measured.quality,
      reason: rejected ? measured.reason : null,
      analysisVersion: ANALYSIS_METHOD,
    },
    localResult: { ...measured, analysisVersion: ANALYSIS_METHOD },
  }
}
