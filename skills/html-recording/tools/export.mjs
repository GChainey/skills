// Package recordings to play somewhere other than the portfolio.
//
//   node export.mjs out/clip.json --to ../some-site/recordings
//     Copies the player (html-recording.js + rrweb-replay.min.js), each recording and the assets
//     it uses into the folder, re-pointing assets at "<folder URL>/assets". Then on any page:
//       <script src="recordings/html-recording.js"></script>
//       <html-recording src="recordings/clip.json"></html-recording>
//     --url /recordings   the URL the folder is served at (default: its path relative to --root)
//     --root .            the site root, to work that URL out (default: cwd)
//
//   node export.mjs out/clip.json --single clip.html [--title "…"] [--bar] [--controls]
//     One self-contained HTML file: player, recording and assets (as data URIs) inline. For
//     Slack, Notion, email or a quick share; it opens from disk.
//
//   --asset-path /replays/assets   what the recordings were localised to (default)
import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const args = process.argv.slice(2)
const opt = { assetPath: '/replays/assets', files: [], title: 'Recording' }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--to') opt.to = args[++i]
  else if (a === '--single') opt.single = args[++i]
  else if (a === '--url') opt.url = args[++i]
  else if (a === '--root') opt.root = args[++i]
  else if (a === '--asset-path') opt.assetPath = args[++i].replace(/\/$/, '')
  else if (a === '--title') opt.title = args[++i]
  else if (a === '--bar') opt.bar = true
  else if (a === '--controls') opt.controls = true
  else opt.files.push(a)
}
if (!opt.files.length || (!opt.to && !opt.single)) {
  console.error('usage: node export.mjs <recording.json…> (--to <folder> [--url /path] | --single <file.html>)')
  process.exit(1)
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css', mp4: 'video/mp4', webm: 'video/webm' }

// The assets a recording points at, found in the assets folder beside it
function used(json, file) {
  const dir = path.join(path.dirname(path.resolve(file)), 'assets')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => json.includes(`${opt.assetPath}/${f}`)).map((f) => ({ name: f, from: path.join(dir, f) }))
}

if (opt.to) {
  const to = path.resolve(opt.to)
  fs.mkdirSync(path.join(to, 'assets'), { recursive: true })
  const url = (opt.url || '/' + path.relative(path.resolve(opt.root || '.'), to).split(path.sep).join('/')).replace(/\/$/, '')
  for (const f of ['html-recording.js', 'rrweb-replay.min.js']) fs.copyFileSync(path.join(HERE, 'player', f), path.join(to, f))
  for (const file of opt.files) {
    let json = fs.readFileSync(file, 'utf8')
    for (const a of used(json, file)) {
      fs.copyFileSync(a.from, path.join(to, 'assets', a.name))
      json = json.split(`${opt.assetPath}/${a.name}`).join(`${url}/assets/${a.name}`)
    }
    fs.writeFileSync(path.join(to, path.basename(file)), json)
    console.log(`${path.basename(file)} → ${to} (assets at ${url}/assets, ${Math.round(json.length / 1024)} KB)`)
  }
}

if (opt.single) {
  const blocks = opt.files.map((file, i) => {
    let json = fs.readFileSync(file, 'utf8')
    for (const a of used(json, file)) {
      const ext = path.extname(a.name).slice(1)
      json = json.split(`${opt.assetPath}/${a.name}`).join(`data:${MIME[ext] || 'application/octet-stream'};base64,${fs.readFileSync(a.from).toString('base64')}`)
    }
    return `<script type="application/json" id="rec-${i}">${json.replace(/<\/script/gi, '<\\/script')}</script>\n<html-recording src="#rec-${i}"${opt.bar ? ' bar' : ''}${opt.controls ? ' controls' : ''}></html-recording>`
  })
  const lib = fs.readFileSync(path.join(HERE, 'player/rrweb-replay.min.js'), 'utf8')
  const el = fs.readFileSync(path.join(HERE, 'player/html-recording.js'), 'utf8')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opt.title}</title>
<style>body { margin: 0; padding: 48px 24px; background: #f4f4f5; } main { max-width: 1100px; margin: 0 auto; display: grid; gap: 48px; }</style>
<script>${lib.replace(/<\/script/gi, '<\\/script')}</script>
<script>${el.replace(/<\/script/gi, "<\\/script")}</script>
</head><body><main>
${blocks.join('\n')}
</main></body></html>
`
  fs.writeFileSync(opt.single, html)
  console.log(`${opt.single} (${Math.round(html.length / 1024)} KB, self-contained)`)
}
