export const SHARED_RECORDING_LIMIT_BYTES = 80 * 1024 * 1024

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A failed upload holds publication until the researcher retries or explicitly drops the file. */
export function nextPublicationAction(input: {
  includeRecording: boolean
  uploadFailed: boolean
  publishWithoutConfirmed: boolean
}): 'upload' | 'publish-without' | 'hold' {
  if (!input.includeRecording || input.publishWithoutConfirmed) return 'publish-without'
  if (input.uploadFailed) return 'hold'
  return 'upload'
}
