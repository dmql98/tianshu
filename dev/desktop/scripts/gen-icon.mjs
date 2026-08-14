/**
 * Generates a real multi-size icon.ico (16/24/32/48/64/128/256, PNG-embedded,
 * Vista+ ICO format) and a 512px icon.png for the TianShu desktop client.
 * Pure Node: zlib + hand-rolled PNG decode/encode and ICO container, no image
 * dependencies.
 *
 * Source: the TianShu logo PNG (default web/client/dist/logo.png). The script
 * decodes it, resamples to each required size (alpha-aware area average) and
 * embeds the results.
 */
import { deflateSync, inflateSync } from 'zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '..', 'assets')
mkdirSync(assetsDir, { recursive: true })

// ── PNG decode ──────────────────────────────────────────────────────────────
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

/** Decode an RGBA8 PNG (bit depth 8, colour type 6) into a raw RGBA buffer. */
function decodePNG(data) {
  if (data.length < 8) throw new Error('not a PNG')
  const sig = data.subarray(0, 8)
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('invalid PNG signature')
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks = []
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      const compression = body[10]
      const filter = body[11]
      const interlace = body[12]
      if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(`unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`)
      }
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error('unsupported PNG compression/filter/interlace')
      }
    } else if (type === 'IDAT') {
      idatChunks.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (!width || !height) throw new Error('missing IHDR')

  const bpp = 4 // bytes per pixel (RGBA)
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idatChunks))
  if (raw.length !== stride * height + height) throw new Error('IDAT size mismatch')

  const out = Buffer.alloc(stride * height)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    if (pb <= pc) return b
    return c
  }
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const x = line[i]
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v
      switch (filterType) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: v = x + paeth(a, b, c); break
        default: throw new Error(`unknown PNG filter ${filterType}`)
      }
      cur[i] = v & 0xff
    }
    cur.copy(out, y * stride)
    cur.copy(prev)
  }
  return { width, height, rgba: out }
}

/**
 * Alpha-aware area-average resample (works for both down- and up-scaling).
 * Colours are averaged premultiplied to avoid fringes at translucent edges.
 */
function resample(srcW, srcH, src, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor((y * srcH) / dstH)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor((x * srcW) / dstW)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dstW))
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4
          const a = src[i + 3]
          sr += src[i] * a
          sg += src[i + 1] * a
          sb += src[i + 2] * a
          sa += a
          n++
        }
      }
      const o = (y * dstW + x) * 4
      if (sa === 0) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      } else {
        out[o] = Math.round(sr / sa)
        out[o + 1] = Math.round(sg / sa)
        out[o + 2] = Math.round(sb / sa)
        out[o + 3] = Math.round(sa / n)
      }
    }
  }
  return out
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

// ── Source logo ─────────────────────────────────────────────────────────────
const sourcePath =
  process.argv[2] ?? join(__dirname, '..', '..', 'web', 'client', 'dist', 'logo.png')
const src = decodePNG(readFileSync(sourcePath))

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const pngs = ICO_SIZES.map((size) => ({
  size,
  data: encodePNG(size, size, resample(src.width, src.height, src.rgba, size, size)),
}))
const ico = encodeICO(pngs)
writeFileSync(join(assetsDir, 'icon.ico'), ico)

const PNG_SIZE = 512
const png512 = encodePNG(PNG_SIZE, PNG_SIZE, resample(src.width, src.height, src.rgba, PNG_SIZE, PNG_SIZE))
writeFileSync(join(assetsDir, 'icon.png'), png512)

console.log(
  `Generated icon.ico (${ICO_SIZES.length} sizes, ${ico.length} bytes) and icon.png (${png512.length} bytes) from ${sourcePath}`
)
