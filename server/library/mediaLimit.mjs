import { LibraryError } from './errors.mjs'

export const SHARED_MEDIA_LIMIT_BYTES = 80 * 1024 * 1024

const MEDIA_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime'])

export function mediaContentType(header) {
  const type = String(header ?? '').split(';')[0].trim().toLowerCase()
  if (!MEDIA_TYPES.has(type)) throw new LibraryError('invalid', 'content-type')
  return type
}
