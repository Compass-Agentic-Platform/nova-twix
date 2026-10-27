#!/usr/bin/env node
/**
 * prepare-mac-icon.js
 *
 * Produces a macOS `.icns` icon for a Tauri source tree when the source only
 * ships a Windows `.ico` (or a PNG that is not yet an `.icns`). This is a
 * best-effort helper run inside `publish-mac.yml` on a macOS runner; it relies
 * on the built-in `sips` and `iconutil` tools and has no effect when an
 * `.icns` already exists.
 *
 * Usage:
 *   node scripts/prepare-mac-icon.js <src-tauri-dir>
 *
 * Behaviour:
 *   1. If `<src-tauri-dir>/icons/icon.icns` already exists, exit 0.
 *   2. Otherwise find a source image: prefer a PNG of at least 512x512, else
 *      extract the largest frame from the `.ico` (modern `.ico` frames are
 *      usually PNGs; a BMP frame is handled too).
 *   3. Normalise to a 1024x1024 PNG, build an `.iconset`, and assemble the
 *      `.icns` with `iconutil`.
 */

'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const srcTauriDir = process.argv[2]
if (!srcTauriDir) {
  console.error('Usage: node scripts/prepare-mac-icon.js <src-tauri-dir>')
  process.exit(1)
}

const iconsDir = path.join(srcTauriDir, 'icons')
const icnsPath = path.join(iconsDir, 'icon.icns')

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

// ── 1. Already have an icns? Nothing to do. ─────────────────────────────────
if (fs.existsSync(icnsPath)) {
  console.log(`[icon] Using existing ${icnsPath}`)
  process.exit(0)
}

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true })
}

// ── 2. Locate a source image ────────────────────────────────────────────────

/** Parses an .ico and returns the bytes of its largest frame. */
function parseIco(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 6 || buf.readUInt16LE(2) !== 1) {
    throw new Error(`${filePath} is not a valid .ico (missing ICONDIR header)`)
  }
  const count = buf.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    if (off + 16 > buf.length) break
    const w = buf[off] || 256
    const h = buf[off + 1] || 256
    const size = buf.readUInt32LE(off + 8)
    const offset = buf.readUInt32LE(off + 12)
    if (offset + size > buf.length) continue
    const area = w * h
    if (!best || area > best.area) best = { size, offset, area }
  }
  if (!best) throw new Error(`${filePath} contains no usable frames`)
  return buf.subarray(best.offset, best.offset + best.size)
}

/** Returns the first PNG in the icons dir that is at least 512x512, if any. */
function findLargePng() {
  const entries = fs.existsSync(iconsDir) ? fs.readdirSync(iconsDir) : []
  const pngs = entries
    .filter((f) => /\.png$/i.test(f))
    .map((f) => path.join(iconsDir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)

  for (const png of pngs) {
    try {
      const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', png], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const width = Number((out.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0)
      const height = Number((out.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0)
      if (width >= 512 && height >= 512) return png
    } catch {
      // Not a readable image — try the next candidate.
    }
  }
  return null
}

let basePng = findLargePng()

if (!basePng) {
  const icoEntries = fs.existsSync(iconsDir)
    ? fs.readdirSync(iconsDir).filter((f) => /\.ico$/i.test(f))
    : []
  if (icoEntries.length === 0) {
    console.error(
      `[icon] No .icns, .png or .ico found under ${iconsDir}. ` +
        'Provide a 1024x1024 icon.png (or an icon.icns) in the source repo.'
    )
    process.exit(1)
  }

  const icoPath = path.join(iconsDir, icoEntries[0])
  console.log(`[icon] Extracting largest frame from ${icoPath}`)
  const frame = parseIco(icoPath)
  const isPng = frame.length > 4 && frame[0] === 0x89 && frame.toString('ascii', 1, 4) === 'PNG'
  const ext = isPng ? 'png' : 'bmp'
  basePng = path.join(iconsDir, `__icon_extracted.${ext}`)
  fs.writeFileSync(basePng, frame)
}

// ── 3. Normalise to 1024x1024, build an .iconset, assemble the .icns ───────
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-twix-icon-'))
const base1024 = path.join(workDir, 'icon_1024x1024.png')
const iconsetDir = path.join(workDir, 'icon.iconset')

console.log(`[icon] Normalising ${basePng} to 1024x1024`)
run('sips', ['-z', '1024', '1024', basePng, '--out', base1024])

fs.mkdirSync(iconsetDir, { recursive: true })
const sizes = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
}
for (const [name, size] of Object.entries(sizes)) {
  run('sips', ['-z', String(size), String(size), base1024, '--out', path.join(iconsetDir, name)])
}

console.log(`[icon] Assembling ${icnsPath}`)
run('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath])

// Remove the temporary frame we may have written inside icons/.
for (const ext of ['png', 'bmp']) {
  const tmp = path.join(iconsDir, `__icon_extracted.${ext}`)
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
}

console.log(`[icon] Done → ${icnsPath}`)
