// Builds store-ready packages into ./dist:
//   dist/dubmaster-import-chrome-edge.zip  (Chrome Web Store + Edge Add-ons)
//   dist/dubmaster-import-firefox.zip      (Firefox Add-ons / AMO)
//   dist/chrome-edge/, dist/firefox/       (unpacked, for local testing)
// Run: node build.mjs   (from the extension folder; uses the frontend's sharp)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
const FILES = ['background.js', 'content.js']

// Placeholder brand icon (purple→cyan, "D"). Replace icons/ with final art.
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#A855F7"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <text x="64" y="90" font-family="Arial,Helvetica,sans-serif" font-size="80" font-weight="700"
        fill="#fff" text-anchor="middle">D</text>
</svg>`
mkdirSync(join(here, 'icons'), { recursive: true })
for (const s of [16, 32, 48, 128]) {
  await sharp(Buffer.from(iconSvg)).resize(s, s).png().toFile(join(here, 'icons', `icon-${s}.png`))
}

rmSync(dist, { recursive: true, force: true })
const base = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))

function stage(name, manifest) {
  const dir = join(dist, name)
  mkdirSync(dir, { recursive: true })
  for (const f of FILES) cpSync(join(here, f), join(dir, f))
  cpSync(join(here, 'icons'), join(dir, 'icons'), { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return dir
}

// Minimal STORE-method zip — no external tools. `tar -a` is bsdtar-only
// (Windows/macOS); GNU tar and Alpine can't write ZIP, so the build was
// platform-limited. Extension payloads are small; STORE (uncompressed)
// entries are accepted by every store uploader.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile()) yield p
  }
}
function zip(dir, out) {
  const files = [...walk(dir)]
  const chunks = []
  const central = []
  let offset = 0
  for (const abs of files) {
    const name = relative(dir, abs).split(sep).join('/')
    const nameBuf = Buffer.from(name, 'utf8')
    const data = readFileSync(abs)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x0800, 6)      // UTF-8 names flag
    local.writeUInt16LE(0, 8)           // STORE
    local.writeUInt16LE(0, 10)          // mod time
    local.writeUInt16LE(0x21, 12)       // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)          // no extra
    chunks.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    // extra len, comment len, disk, internal attrs — all zero
    cd.writeUInt32LE(statSync(abs).mode & 0xffff << 16, 38) // external attrs
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += 30 + nameBuf.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  writeFileSync(join(dist, out), Buffer.concat([...chunks, cdBuf, eocd]))
}

// Chrome / Edge: service worker background, as authored.
const chromeDir = stage('chrome-edge', base)
zip(chromeDir, 'dubmaster-import-chrome-edge.zip')

// Firefox: no service_worker support in MV3 — use background.scripts and add
// the add-on id + the data-collection declaration AMO requires.
const ff = structuredClone(base)
ff.background = { scripts: ['background.js'] }
ff.browser_specific_settings = {
  gecko: {
    id: 'import@dubmasterai.com',
    strict_min_version: '140.0',
    data_collection_permissions: { required: ['none'] },
  },
}
const ffDir = stage('firefox', ff)
zip(ffDir, 'dubmaster-import-firefox.zip')

console.log('Built', dist)
