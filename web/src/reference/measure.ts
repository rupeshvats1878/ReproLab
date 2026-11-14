export interface Region { x: number; y: number; width: number; height: number }
export interface Measurement {
  quality: 'accepted' | 'rejected'
  reason: string
  dispersion: number | null
  clippedFraction: number
}
export const DEFAULT_REGION: Region = { x: 32, y: 25, width: 36, height: 50 }

// Percent coordinates relative to the decoded image, never the letterboxed player.
export function validRegion(r: Region): boolean {
  return Object.values(r).every(Number.isFinite) && r.x >= 0 && r.y >= 0 &&
    r.width >= 5 && r.height >= 5 && r.x + r.width <= 100 && r.y + r.height <= 100
}

// Spatial RGB chromaticity dispersion of a 6x6 grid. This is an exploratory
// image statistic, NOT mixing probability, concentration, or a chemical endpoint.
export function measure(data: Uint8ClampedArray, width: number, height: number): Measurement {
  const reject = (reason: string, clippedFraction = 0): Measurement =>
    ({ quality: 'rejected', reason, dispersion: null, clippedFraction })
  if (width < 12 || height < 12 || data.length !== width * height * 4) return reject('Region too small or invalid pixels')
  let clipped = 0
  const cells: number[][] = []
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) {
    let rr = 0, gg = 0, bb = 0, count = 0
    for (let y = Math.floor(gy * height / 6); y < Math.floor((gy + 1) * height / 6); y++) {
      for (let x = Math.floor(gx * width / 6); x < Math.floor((gx + 1) * width / 6); x++) {
        const i = (y * width + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2], sum = r + g + b
        if (sum < 45 || Math.min(r, g, b) > 248) { clipped++; continue }
        rr += r / sum; gg += g / sum; bb += b / sum; count++
      }
    }
    if (count) cells.push([rr / count, gg / count, bb / count])
  }
  const fraction = clipped / (width * height)
  if (fraction > 0.25 || cells.length < 30) return reject('Too much dark/clipped area; choose a clear liquid region', fraction)
  const mean = [0, 1, 2].map(c => cells.reduce((s, v) => s + v[c], 0) / cells.length)
  const dispersion = Math.sqrt(cells.reduce((s, v) => s + v.reduce((a, x, c) => a + (x - mean[c]) ** 2, 0), 0) / cells.length)
  return { quality: 'accepted', reason: 'Pixel quality check passed; verify framing and obstructions manually', dispersion, clippedFraction: fraction }
}
