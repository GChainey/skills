#!/usr/bin/env node
// Recording Studio: a local editor for HTML recordings.
//
//   node studio/server.mjs [folder…] [--port 4747] [--no-open]
//
// Lists every recording under the folders (default: the current one), and serves the studio:
// scrub a take, cut, speed up, zoom, highlight and caption it, then export. Edits are saved as
// <name>.edit.json beside each recording; the recording itself is never changed. Re-record runs
// the clip script that made the take again, with the studio's cursor speed, pauses, screen and theme.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'

const HERE = import.meta.dirname
const TOOLS = path.join(HERE, '..', 'tools')
const DIST = path.join(HERE, 'dist')

const args = process.argv.slice(2)
const opt = { dirs: [], port: 4747, open: true }
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') opt.port = Number(args[++i])
  else if (args[i] === '--no-open') opt.open = false
  else opt.dirs.push(path.resolve(args[i]))
}
if (!opt.dirs.length) opt.dirs.push(process.cwd())

const SKIP = new Set(['node_modules', '.git', '.next', 'assets', 'dist', 'build', '.turbo'])
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm' }

const idOf = (file) => Buffer.from(file).toString('base64url')
const fileOf = (id) => {
  const file = Buffer.from(String(id), 'base64url').toString()
  // Only files under the folders the studio was opened on
  if (!opt.dirs.some((d) => file === d || file.startsWith(d + path.sep))) throw Object.assign(new Error('Not in the studio folders'), { status: 403 })
  return file
}
const editFileOf = (file) => file.replace(/\.json$/, '.edit.json')

// A recording is {"meta": …, "events": […]}: read meta from the head of the file, not all of it
function readMeta(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(16384)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    const head = buf.toString('utf8', 0, n)
    if (!head.startsWith('{"meta":')) return null
    const end = head.indexOf(',"events":')
    if (end < 0) return null
    return JSON.parse(head.slice(8, end))
  } catch { return null } finally { fs.closeSync(fd) }
}

const assetDirs = new Set()
let reelsFound = []
function scan() {
  const found = []
  const reels = []
  const walk = (dir, depth) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'assets') assetDirs.add(full)
        if (!SKIP.has(e.name) && !e.name.startsWith('.') && depth < 5) walk(full, depth + 1)
      } else if (e.name.endsWith('.reel.json')) {
        const root = opt.dirs.find((d) => full.startsWith(d))
        reels.push({ id: idOf(full), name: e.name.replace(/\.reel\.json$/, ''), folder: path.relative(root, path.dirname(full)) || path.basename(root), file: full, modified: fs.statSync(full).mtimeMs })
      } else if (e.name.endsWith('.json') && !e.name.endsWith('.edit.json') && !e.name.startsWith('package')) {
        const meta = readMeta(full)
        if (!meta) continue
        const root = opt.dirs.find((d) => full.startsWith(d))
        found.push({
          id: idOf(full),
          name: path.basename(full, '.json'),
          folder: path.relative(root, path.dirname(full)) || path.basename(root),
          file: full,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          edited: fs.existsSync(editFileOf(full)),
          canRecord: !!meta.take?.script && fs.existsSync(meta.take.script),
          modified: fs.statSync(full).mtimeMs,
        })
      }
    }
  }
  for (const d of opt.dirs) walk(d, 0)
  reelsFound = reels.sort((a, b) => b.modified - a.modified)
  return found.sort((a, b) => b.modified - a.modified)
}

// Assets are referenced by URL (…/assets/<hash>.<ext>): find the file in any assets folder
function findAsset(name) {
  for (const d of assetDirs) {
    const f = path.join(d, name)
    if (fs.existsSync(f)) return f
  }
  return null
}

const jobs = new Map()
let jobCount = 0
function rerecord(file, knobs) {
  const meta = readMeta(file)
  const take = meta?.take
  if (!take?.script) throw Object.assign(new Error('No script on record for this take'), { status: 400 })
  const id = String(++jobCount)
  const job = { id, file, status: 'running', log: '', startedAt: Date.now() }
  jobs.set(id, job)
  const env = {
    ...process.env,
    BASE_URL: take.baseUrl, RR_OUT: take.out, RR_ASSET_PATH: take.assetPath,
    ...(knobs.glide ? { RR_GLIDE: String(knobs.glide) } : {}),
    ...(knobs.pause ? { RR_PAUSE: String(knobs.pause) } : {}),
    ...(knobs.viewport ? { RR_VIEWPORT: `${knobs.viewport.width}x${knobs.viewport.height}` } : {}),
    ...(knobs.scheme ? { RR_SCHEME: knobs.scheme } : {}),
  }
  const child = spawn(process.execPath, [take.script, take.clip], { cwd: path.dirname(take.script), env })
  const add = (d) => { job.log += d.toString(); if (job.log.length > 20000) job.log = job.log.slice(-20000) }
  child.stdout.on('data', add)
  child.stderr.on('data', add)
  child.on('close', (code) => { job.status = code === 0 ? 'done' : 'failed'; job.code = code })
  return job
}

// Reels: render to MP4 or a single HTML file in the background, reporting progress
function renderReel(file, kind) {
  const id = String(++jobCount)
  const out = file.replace(/\.reel\.json$/, kind === 'mp4' ? '.mp4' : '.html')
  const job = { id, file, out, kind, status: 'running', progress: 0, log: '', startedAt: Date.now() }
  jobs.set(id, job)
  const child = spawn(process.execPath, [path.join(TOOLS, 'reel.mjs'), file, kind === 'mp4' ? '--mp4' : '--single', out], { cwd: path.dirname(file) })
  const add = (d) => {
    const text = d.toString()
    for (const m of text.matchAll(/progress ([\d.]+)/g)) job.progress = Number(m[1])
    job.log += text
    if (job.log.length > 20000) job.log = job.log.slice(-20000)
  }
  child.stdout.on('data', add)
  child.stderr.on('data', add)
  child.on('close', (code) => { job.status = code === 0 ? 'done' : 'failed'; job.progress = code === 0 ? 1 : job.progress })
  return job
}

// A first reel from the takes in a folder: opener, then a card and a demo per take, then the outro
function newReel(folder) {
  const dir = opt.dirs.map((d) => path.join(d, folder)).find((d) => fs.existsSync(d)) || opt.dirs[0]
  let name = 'reel', n = 1
  while (fs.existsSync(path.join(dir, `${name}.reel.json`))) name = `reel-${++n}`
  const takes = scan().filter((r) => path.dirname(r.file) === dir).slice(0, 5).reverse()
  const id = () => Math.random().toString(36).slice(2, 9)
  const reel = {
    version: 1, shape: '16:9', background: 'dusk', cards: 'light', brand: { mark: null },
    scenes: [
      { id: id(), type: 'opener', title: 'New in your product', sub: 'What this reel shows', duration: 3000 },
      ...takes.flatMap((t) => [
        { id: id(), type: 'card', text: t.name.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()), duration: 2000 },
        { id: id(), type: 'demo', take: path.basename(t.file), from: 0, to: t.duration },
      ]),
      { id: id(), type: 'outro', text: '', duration: 2500 },
    ],
  }
  const file = path.join(dir, `${name}.reel.json`)
  fs.writeFileSync(file, JSON.stringify(reel, null, 2) + '\n')
  return file
}

function exportSingle(file) {
  return new Promise((resolve, reject) => {
    const out = file.replace(/\.json$/, '.html')
    const title = path.basename(file, '.json')
    execFile(process.execPath, [path.join(TOOLS, 'export.mjs'), file, '--single', out, '--bar', '--controls', '--title', title], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ path: out, log: stdout.trim() })
    })
  })
}

const body = (req) => new Promise((resolve, reject) => {
  let data = ''
  req.on('data', (c) => { data += c })
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) } })
})
const send = (res, status, data, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(data) : data)
}
const sendFile = (res, file) => {
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = decodeURIComponent(url.pathname)
  try {
    if (p === '/api/recordings') { const recordings = scan(); return send(res, 200, { folders: opt.dirs, recordings, reels: reelsFound }) }
    if (p === '/api/reel') {
      const file = fileOf(url.searchParams.get('id'))
      if (req.method === 'PUT') {
        fs.writeFileSync(file, JSON.stringify(await body(req), null, 2) + '\n')
        return send(res, 200, { saved: true })
      }
      return send(res, 200, { reel: JSON.parse(fs.readFileSync(file, 'utf8')), dir: path.dirname(file) })
    }
    if (p === '/api/reel/new' && req.method === 'POST') {
      const { folder = '' } = await body(req)
      const file = newReel(folder)
      return send(res, 200, { id: idOf(file) })
    }
    if (p === '/api/reel/render' && req.method === 'POST') {
      const { id, kind } = await body(req)
      const job = renderReel(fileOf(id), kind === 'mp4' ? 'mp4' : 'html')
      return send(res, 200, { job: job.id })
    }
    if (p === '/api/recording') return sendFile(res, fileOf(url.searchParams.get('id')))
    if (p === '/api/edit') {
      const file = editFileOf(fileOf(url.searchParams.get('id')))
      if (req.method === 'PUT') {
        const edit = await body(req)
        fs.writeFileSync(file, JSON.stringify(edit, null, 2) + '\n')
        return send(res, 200, { saved: true })
      }
      if (req.method === 'DELETE') { fs.rmSync(file, { force: true }); return send(res, 200, { deleted: true }) }
      return fs.existsSync(file) ? sendFile(res, file) : send(res, 200, null)
    }
    if (p === '/api/rerecord' && req.method === 'POST') {
      const { id, knobs = {} } = await body(req)
      const job = rerecord(fileOf(id), knobs)
      return send(res, 200, { job: job.id })
    }
    if (p.startsWith('/api/jobs/')) {
      const job = jobs.get(p.split('/').pop())
      return job ? send(res, 200, job) : send(res, 404, { error: 'No such job' })
    }
    if (p === '/api/export' && req.method === 'POST') {
      const { id } = await body(req)
      return send(res, 200, await exportSingle(fileOf(id)))
    }
    if (p === '/api/reveal' && req.method === 'POST') {
      const { path: target } = await body(req)
      if (process.platform === 'darwin') execFile('open', ['-R', target])
      return send(res, 200, { ok: true })
    }
    // The recordings' images, fonts and CSS
    const assetMatch = p.match(/\/assets\/([^/]+)$/)
    if (assetMatch && !p.startsWith('/studio-assets/')) {
      const f = findAsset(assetMatch[1])
      if (f) return sendFile(res, f)
    }
    // The studio itself
    const f = path.join(DIST, p === '/' ? 'index.html' : p)
    if (f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(res, f)
    if (!path.extname(p)) return sendFile(res, path.join(DIST, 'index.html'))
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    send(res, e.status || 500, { error: e.message })
  }
})

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e
  console.error(`Port ${opt.port} is in use (another studio?). Try: node studio/server.mjs --port ${opt.port + 1}`)
  process.exit(1)
})
server.listen(opt.port, () => {
  const url = `http://localhost:${opt.port}`
  scan()
  console.log(`Recording Studio: ${url}\n${opt.dirs.map((d) => `  ${d}`).join('\n')}`)
  if (opt.open && process.platform === 'darwin') execFile('open', [url])
})
