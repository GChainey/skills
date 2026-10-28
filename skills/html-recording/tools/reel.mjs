// Render a sizzle reel (<name>.reel.json) for where it's going.
//
//   node reel.mjs <name>.reel.json --mp4 <out.mp4> [--fps 30]
//     A video for X, LinkedIn, YouTube and anywhere else that wants a file. Every frame is drawn by
//     the reel player (Reel.render(t)) in headless Chromium at the reel's full size, screenshotted
//     and piped to ffmpeg, so the video is exactly what the HTML plays. Needs ffmpeg on the PATH.
//
//   node reel.mjs <name>.reel.json --single <out.html>
//     One self-contained page: the player, the reel, every take it uses (with their studio edits)
//     and their assets as data URIs. Opens from disk.
//
// Progress lines go to stdout as `progress <0..1>`, for the studio.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const HERE = import.meta.dirname
const PLAYER = path.join(HERE, 'player')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' }

export function readReel(file) {
  const reel = JSON.parse(fs.readFileSync(file, 'utf8'))
  const dir = path.dirname(path.resolve(file))
  const takes = {}
  for (const s of reel.scenes || []) {
    if (s.type !== 'demo' || takes[s.take]) continue
    const recFile = path.resolve(dir, s.take)
    if (!fs.existsSync(recFile)) throw new Error(`The take ${s.take} isn't beside the reel (${recFile})`)
    const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'))
    const editFile = recFile.replace(/\.json$/, '.edit.json')
    if (!rec.edit && fs.existsSync(editFile)) rec.edit = JSON.parse(fs.readFileSync(editFile, 'utf8'))
    takes[s.take] = { rec, file: recFile }
  }
  return { reel, dir, takes }
}

// Assets are referenced as …/assets/<hash>.<ext>: find them in an assets folder near the reel
export function assetFinder(dir) {
  const dirs = []
  const walk = (d, depth) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(d, e.name)
      if (e.name === 'assets') dirs.push(full)
      else if (depth < 4) walk(full, depth + 1)
    }
  }
  for (let d = dir, i = 0; i < 3; i++, d = path.dirname(d)) { walk(d, i ? 3 : 0) }
  return (name) => dirs.map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) || null
}

function serve(dir, find) {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = null
    if (p === '/__render') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); return }
    if (p.startsWith('/__player/')) file = path.join(PLAYER, path.basename(p))
    else if (/\/assets\/[^/]+$/.test(p)) file = find(path.basename(p))
    else file = path.join(dir, p)
    if (!file || !file.startsWith('/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, () => resolve(server)))
}

export async function renderMp4(file, out, { fps = 30, onProgress } = {}) {
  const { reel, dir, takes } = readReel(file)
  const server = await serve(dir, assetFinder(dir))
  const port = server.address().port
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    // From the local server, so the recordings' /…/assets/… paths resolve to the reel's assets
    await page.goto(`http://localhost:${port}/__render`)
    await page.addScriptTag({ url: `http://localhost:${port}/__player/rrweb-replay.min.js` })
    await page.addScriptTag({ url: `http://localhost:${port}/__player/edits.js` })
    await page.addScriptTag({ url: `http://localhost:${port}/__player/reel.js` })
    const size = await page.evaluate(({ reel }) => globalThis.HtmlReel.SHAPES[reel.shape] || globalThis.HtmlReel.SHAPES['16:9'], { reel })
    await page.setViewportSize(size)
    const length = await page.evaluate(async ({ reel, takes }) => {
      document.documentElement.style.cssText = 'margin:0;background:#000'
      document.body.style.cssText = 'margin:0'
      const font = document.createElement('link')
      font.rel = 'stylesheet'
      font.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&display=block'
      document.head.appendChild(font)
      await new Promise((r) => { font.onload = r; font.onerror = r; setTimeout(r, 4000) })
      await document.fonts.ready
      const root = document.createElement('div')
      root.style.cssText = 'position:relative;width:100vw'
      document.body.appendChild(root)
      window.__reel = new globalThis.HtmlReel.Reel(root, reel, takes)
      await new Promise((r) => setTimeout(r, 800))
      return window.__reel.length
    }, { reel, takes: Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.rec])) })

    const frames = Math.ceil((length / 1000) * fps)
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
    const done = new Promise((resolve, reject) => {
      ff.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('ffmpeg is needed for MP4: brew install ffmpeg') : e))
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
    })
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => new Promise((r) => { window.__reel.render(t); requestAnimationFrame(() => requestAnimationFrame(r)) }), (i * 1000) / fps)
      const jpg = await page.screenshot({ type: 'jpeg', quality: 92 })
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
      if (i % fps === 0) onProgress?.(i / frames)
    }
    ff.stdin.end()
    await done
    onProgress?.(1)
    return { out, seconds: +(length / 1000).toFixed(1), frames }
  } finally {
    await browser.close()
    server.close()
  }
}

const DATA_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css' }

export function renderSingle(file, out, { title } = {}) {
  const { reel, dir, takes } = readReel(file)
  const find = assetFinder(dir)
  let json = JSON.stringify({ ...reel, takes: Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.rec])) })
  // Every …/assets/<file> the takes use becomes a data URI
  json = json.replace(/(?:https?:\/\/[^"'\s)]*?)?\/[^"'\s)]*?assets\/([A-Za-z0-9_.-]+\.[a-z0-9]+)/g, (m, name) => {
    const f = find(name)
    if (!f) return m
    const ext = path.extname(name).slice(1).toLowerCase()
    return `data:${DATA_MIME[ext] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`
  })
  const inline = (f) => fs.readFileSync(path.join(PLAYER, f), 'utf8').replace(/<\/script/gi, '<\\/script')
  const name = title || path.basename(file).replace(/\.reel\.json$/, '')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&display=swap" rel="stylesheet">
<style>body { margin: 0; padding: 48px 24px; background: #f4f4f5; } main { max-width: 1100px; margin: 0 auto; }</style>
<script>${inline('rrweb-replay.min.js')}</script>
<script>${inline('edits.js')}</script>
<script>${inline('reel.js')}</script>
</head><body><main>
<script type="application/json" id="reel">${json.replace(/<\/script/gi, '<\\/script')}</script>
<html-reel src="#reel" controls></html-reel>
</main></body></html>
`
  fs.writeFileSync(out, html)
  return { out, kb: Math.round(html.length / 1024) }
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2)
  const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return undefined; return args.splice(i, 2)[1] }
  const mp4 = take('--mp4'), single = take('--single'), fps = Number(take('--fps') || 30), title = take('--title')
  const [file] = args
  if (!file || (!mp4 && !single)) { console.error('usage: node reel.mjs <name>.reel.json (--mp4 <out.mp4> [--fps 30] | --single <out.html>)'); process.exit(1) }
  try {
    if (single) console.log(JSON.stringify(renderSingle(file, single, { title })))
    if (mp4) console.log(JSON.stringify(await renderMp4(file, mp4, { fps, onProgress: (p) => console.log(`progress ${p.toFixed(3)}`) })))
  } catch (e) { console.error(e.message); process.exit(1) }
}
