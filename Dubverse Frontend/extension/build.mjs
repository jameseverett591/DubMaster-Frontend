// Builds store-ready packages into ./dist:
//   dist/dubmaster-import-chrome-edge.zip  (Chrome Web Store + Edge Add-ons)
//   dist/dubmaster-import-firefox.zip      (Firefox Add-ons / AMO)
//   dist/chrome-edge/, dist/firefox/       (unpacked, for local testing)
// Run: node build.mjs   (from the extension folder; uses the frontend's sharp)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
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

function zip(dir, out) {
  // bsdtar (ships with Windows 10+/macOS) writes a standard zip with / paths.
  // Relative paths + cwd: GNU tar reads "C:" as a remote host.
  execFileSync('tar', ['-a', '-c', '-f', '../' + out, '.'], { cwd: dir })
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
