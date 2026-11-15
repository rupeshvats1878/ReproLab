import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
export const exec = promisify(execFile)
export const MAX_BYTES = 8 * 1024 * 1024
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function mediaType(type, bytes) {
  const mime = type.split(';')[0].toLowerCase()
  if (!['video/webm', 'video/mp4'].includes(mime)) throw new Error('Unsupported video MIME type.')
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Empty or oversized clip (8 MiB maximum).')
  const valid = mime === 'video/webm' ? bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) : bytes.subarray(4,8).toString() === 'ftyp'
  if (!valid) throw new Error('The clip does not match its media type.')
  return mime
}
export async function normalize(input, output, requestedDuration, env = process.env) {
  // Explicit demuxer + file-only protocol prevent playlists/URLs from reading arbitrary sources.
  const format = input.endsWith('.webm') ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2'
  const { stdout } = await exec(env.FFPROBE || 'ffprobe', ['-v','error','-protocol_whitelist','file','-f',format,'-show_entries','format=duration:stream=codec_type,width,height','-of','json',input], { timeout: 5000, maxBuffer: 100_000 })
  const info = JSON.parse(stdout)
  const video = info.streams?.find(s => s.codec_type === 'video')
  if (!video || video.width > 1920 || video.height > 1080 || !video.width || !video.height) throw new Error('Invalid or oversized video dimensions.')
  const declared = Number(info.format?.duration) * 1000
  if (Number.isFinite(declared) && (declared < 250 || declared > 20_500 || Math.abs(declared-requestedDuration) > 2000)) throw new Error('Clip duration does not match its capture window.')
  // Decode the entire bounded file; never silently truncate it to the allowed duration.
  await exec(env.FFMPEG || 'ffmpeg', ['-nostdin','-v','error','-xerror','-protocol_whitelist','file','-f',format,'-i',input,'-map','0:v:0','-an','-vf','scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2','-r','15','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart','-y',output], { timeout: 15_000, maxBuffer: 100_000 })
  const probe = await exec(env.FFPROBE || 'ffprobe', ['-v','error','-show_entries','format=duration','-of','json',output], { timeout:5000, maxBuffer:100_000 })
  const durationMs = Math.round(Number(JSON.parse(probe.stdout).format.duration)*1000)
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > 20_500 || Math.abs(durationMs-requestedDuration)>2000) throw new Error('Decoded clip duration is invalid.')
  if ((await stat(output)).size > MAX_BYTES) throw new Error('Converted clip exceeds 8 MiB.')
  return { durationMs, clipSha256: hash(await readFile(output)) }
}
