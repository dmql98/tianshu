/**
 * Generates a real multi-size icon.ico (16/24/32/48/64/128/256, PNG-embedded,
 * Vista+ ICO format) and a 512px icon.png for the TianShu desktop client.
 * Pure Node: zlib + hand-rolled PNG/ICO container, no image dependencies.
 *
 * Design: deep-navy rounded square with a bright four-point "pole star"
 * (天枢 = the pivot star of the Big Dipper) at the centre.
 */
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '..', 'assets')
mkdirSync(assetsDir, { recursive: true })

// ── PNG encoding ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── ICO container (Vista+ PNG entries) ──────────────────────────────────────
function encodeICO(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const p of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = p.size >= 256 ? 0 : p.size
    entry[1] = p.size >= 256 ? 0 : p.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(p.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += p.data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

// ── Drawing ─────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a, b, t) => a + (b - a) * t

function roundedRectDist(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r)
  const dy = Math.abs(y - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const half = size * 0.5
  const radius = size * 0.24
  const starHalf = size * 0.32
  const innerHalf = size * 0.12

  const top = [34, 72, 122] // top-left background
  const bottom = [11, 24, 48] // bottom-right background
  const starColor = [96, 225, 255] // bright cyan
  const coreColor = [235, 252, 255] // near-white core

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // Rounded-square alpha with a soft 0.75px anti-aliased edge.
      const d = roundedRectDist(px, py, cx, cy, half, half, radius)
      const alpha = clamp(-d + 0.5, 0, 1)

      // Background gradient.
      const t = (px + py) / (2 * size)
      let r = lerp(top[0], bottom[0], t)
      let g = lerp(top[1], bottom[1], t)
      let b = lerp(top[2], bottom[2], t)

      // Four-point star: |x-cx| + |y-cy| <= starHalf, soft edge.
      const starDist = Math.abs(px - cx) + Math.abs(py - cy)
      const starEdge = 1.5
      const starT = clamp((starHalf - starDist) / starEdge, 0, 1)
      if (starT > 0) {
        r = lerp(r, starColor[0], starT)
        g = lerp(g, starColor[1], starT)
        b = lerp(b, starColor[2], starT)
      }

      // Inner diamond core, whiter toward the centre.
      const coreDist = Math.abs(px - cx) + Math.abs(py - cy)
      const coreT = clamp((innerHalf - coreDist) / 2, 0, 1)
      if (coreT > 0) {
        r = lerp(r, coreColor[0], coreT)
        g = lerp(g, coreColor[1], coreT)
        b = lerp(b, coreColor[2], coreT)
      }

      const i = (y * size + x) * 4
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return rgba
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const pngs = ICO_SIZES.map((size) => ({
  size,
  data: encodePNG(size, size, drawIcon(size)),
}))
const ico = encodeICO(pngs)
writeFileSync(join(assetsDir, 'icon.ico'), ico)

const png512 = encodePNG(512, 512, drawIcon(512))
writeFileSync(join(assetsDir, 'icon.png'), png512)

console.log(`Generated icon.ico (${ICO_SIZES.length} sizes, ${ico.length} bytes) and icon.png (${png512.length} bytes)`)
