// Make a recording self-contained. Assets it loaded from a local server (any localhost or
// 127.0.0.1 origin), and images, fonts and CSS from any `origins` given, are downloaded into
// <outDir>/assets and re-pointed at `assetPath`, where the host site serves them. Links to local
// pages are blanked, since a replay can't follow them.
//
// CLI (re-run on an existing recording, e.g. after the server moved):
//   node localise.mjs [--asset-path /replays/assets] [--origin https://site.com] out/*.json
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const LOCAL = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/[^"'\\)\s<>]*/g
const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|css|mp4|webm)$/i
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

async function save(url, outDir, assetPath) {
  const res = await fetch(url).catch(() => null)
  if (!res?.ok) return null
  const type = res.headers.get('content-type') || ''
  const clean = url.split('#')[0].split('?')[0]
  if (!ASSET.test(clean) && !/^(image|font)\/|text\/css/.test(type)) return null
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = (ASSET.test(clean) ? path.extname(clean) : '.' + type.split('/')[1].split(/[;+]/)[0]).toLowerCase()
  const file = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) + ext
  fs.writeFileSync(path.join(outDir, 'assets', file), buf)
  return `${assetPath}/${file}`
}

export async function localise(json, outDir, { assetPath = '/replays/assets', origins = [] } = {}) {
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true })
  // Local server: assets saved, pages blanked
  for (const url of [...new Set(json.match(LOCAL) || [])].sort((a, b) => b.length - a.length)) {
    const clean = url.split('#')[0].split('?')[0]
    const page = /\.(html?|tsx?|jsx?|mjs)$/i.test(clean) || /\/$/.test(clean) || /\/@vite\//.test(clean)
    const to = (!page && await save(url, outDir, assetPath)) || '#'
    if (to === '#' && process.env.LOCALISE_DEBUG) console.log('blanked', url)
    json = json.split(url).join(to)
  }
  // Public origins: only assets are touched, links stay live
  for (const origin of origins) {
    const re = new RegExp(esc(origin.replace(/\/$/, '')) + '/[^"\'\\\\)\\s<>]*', 'g')
    for (const url of [...new Set(json.match(re) || [])].sort((a, b) => b.length - a.length)) {
      const to = await save(url.split('#')[0], outDir, assetPath)
      if (to) json = json.split(url).join(to)
    }
  }
  return json
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const opts = { assetPath: '/replays/assets', origins: [] }
  const files = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--asset-path') opts.assetPath = args[++i]
    else if (args[i] === '--origin') opts.origins.push(args[++i])
    else files.push(args[i])
  }
  for (const f of files) {
    const json = await localise(fs.readFileSync(f, 'utf8'), path.dirname(path.resolve(f)), opts)
    fs.writeFileSync(f, json)
    console.log(f, Math.round(json.length / 1024) + 'kb', (json.match(LOCAL) || []).length, 'local URLs left')
  }
}
