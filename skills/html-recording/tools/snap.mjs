// Screenshot a recording as it plays back, at given seconds: the check before publishing.
//   node snap.mjs out/clip.json 0.5,3,6 [--out .context/snaps]
// Plays it in the same player the exports use, with assets served from the folder beside it.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const HERE = import.meta.dirname
const args = process.argv.slice(2)
const file = path.resolve(args[0])
const times = (args[1] || '1').split(',').map(Number)
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.dirname(file))
const assetPath = args.includes('--asset-path') ? args[args.indexOf('--asset-path') + 1] : '/replays/assets'
const assets = path.join(path.dirname(file), 'assets')
const name = path.basename(file, '.json')
fs.mkdirSync(outDir, { recursive: true })

const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
const { width, height } = rec.meta
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.route('http://snap.local/**', (route) => {
  const u = new URL(route.request().url()).pathname
  if (u === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"><div id="root"></div><script src="/lib.js"></script>' })
  if (u === '/lib.js') return route.fulfill({ contentType: 'text/javascript', path: path.join(HERE, 'player/rrweb-replay.min.js') })
  if (u === '/rec.json') return route.fulfill({ contentType: 'application/json', path: file })
  const f = path.join(assets, path.basename(u))
  if (u.startsWith(assetPath + '/') && fs.existsSync(f)) return route.fulfill({ path: f })
  return route.fulfill({ status: 404, body: '' })
})
await page.goto('http://snap.local/')
await page.evaluate(async () => {
  const rec = await (await fetch('/rec.json')).json()
  window.r = new rrwebReplay.Replayer(rec.events, { root: document.getElementById('root'), mouseTail: false, showWarning: false, UNSAFE_replayCanvas: false })
  window.r.pause(0)
})
await page.addStyleTag({ content: '.replayer-wrapper iframe { border: 0 } .replayer-mouse { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: rgba(17,17,17,.6); box-shadow: 0 0 0 2px #fff } .replayer-mouse-tail { display: none }' })
for (const t of times) {
  await page.evaluate((ms) => window.r.pause(ms), t * 1000)
  await page.waitForTimeout(500)
  const png = path.join(outDir, `${name}-${t}s.png`)
  await page.screenshot({ path: png })
  console.log(png)
}
console.log(`${name}: ${(rec.meta.duration / 1000).toFixed(1)}s`, errors.length ? { errors } : '')
await browser.close()
