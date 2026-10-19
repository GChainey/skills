// HTML recorder: drives a page in headless Chromium and records it with rrweb instead of
// pixels: the DOM, its CSS and every change, as JSON. A player rebuilds that in the page, so a
// "recording" is the real UI, sharp at any size, with exact colours, at a fraction of a video's
// size.
//
//   import { record } from '<skill>/tools/rrlib.mjs'
//   await record('my-clip', async (r) => { await r.goto('/'); await r.start(); await r.click(...) })
//
// Waits sped up with fast() and stretches cut with cut() are retimed in the output.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { localise } from './localise.mjs'
import { fixValues } from './fix-values.mjs'

const HERE = import.meta.dirname
export const BASE = process.env.BASE_URL || 'http://localhost:8000'
// Where recordings land, and the URL the host site will serve <out>/assets from
const OUT = path.resolve(process.env.RR_OUT || 'recordings')
const ASSET_PATH = process.env.RR_ASSET_PATH || '/replays/assets'
const WIDTH = 1280
const HEIGHT = 800
const RECORD_JS = fs.readFileSync(path.join(HERE, 'node_modules/@rrweb/record/dist/record.umd.min.cjs'), 'utf8')

// The page-drawn cursor and click ring (domCursor: true). Recorded as elements, so they're
// under modal dialogs; the default records the mouse natively and the player draws it on top.
const INIT_SCRIPT = `(() => {
  if (window.__reelInit) return; window.__reelInit = true;
  const ready = () => {
    const cursor = document.createElement('div');
    cursor.id = '__reel_cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.4L16.5 20l-2.8 1.3-3.6-7.1L5 18z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' });
    document.documentElement.appendChild(cursor);
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', left: '0', top: '0', width: '28px', height: '28px', marginLeft: '-14px', marginTop: '-14px', borderRadius: '50%', background: 'rgba(17,17,17,.18)', zIndex: '2147483646', pointerEvents: 'none', opacity: '0', transform: 'translate(-100px,-100px) scale(.4)' });
    document.documentElement.appendChild(ring);
    const saved = sessionStorage.getItem('__reel_pos');
    if (saved) { const [x, y] = saved.split(','); cursor.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; }
    document.addEventListener('mousemove', (e) => {
      cursor.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)';
      sessionStorage.setItem('__reel_pos', e.clientX + ',' + e.clientY);
    }, true);
    document.addEventListener('mousedown', (e) => {
      ring.style.transition = 'none';
      ring.style.opacity = '1';
      ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(.4)';
      requestAnimationFrame(() => {
        ring.style.transition = 'transform .35s ease-out, opacity .35s ease-out';
        ring.style.opacity = '0';
        ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(1.5)';
      });
    }, true);
  };
  if (document.body) ready(); else document.addEventListener('DOMContentLoaded', ready);
})();`

// The dev-only measuring toolbar (agentation, "Select (S)") some prototypes carry
const TOOLBAR_SCRIPT = `(() => { const hide = () => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || x.textContent || '').includes('Select (S)')); if (!b) return; let el = b; while (el.parentElement && el.parentElement !== document.body) el = el.parentElement; el.style.display = 'none' }; const go = () => { hide(); new MutationObserver(hide).observe(document.body, { childList: true, subtree: true }) }; if (document.body) go(); else document.addEventListener('DOMContentLoaded', go) })()`

// Starts rrweb in a page. Every event goes to Node with the page's own clock.
const START_RECORDING = `(() => {
  // Only the page itself: hidden iframes would each record a blank snapshot
  if (window.top !== window || window.__rrStop) return;
  window.__rrStop = rrwebRecord.record({
    emit: (e) => window.__rrEmit(JSON.stringify(e)),
    // Images stay as URLs; they're downloaded and re-pointed after recording
    inlineImages: false,
    inlineStylesheet: true,
    recordCanvas: false,
    collectFonts: true,
    maskAllInputs: false,
    // The mouse is recorded as a track the player draws above the replay, so it stays on top of
    // modal dialogs (the top layer) and iframes
    sampling: { mousemove: window.__rrDomCursor ? false : 16, mouseInteraction: !window.__rrDomCursor, scroll: 50, input: 'last' },
  });
})()`

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// Options:
//   viewport     { width, height } in CSS px. 1280×800 (16:10) by default
//   colorScheme  'light' | 'dark'
//   speed        play the whole recording this many times faster
//   domCursor    draw the cursor as a page element instead of recording the mouse
//   setup(ctx)   before the page opens: block requests, add init scripts, set cookies
//   out          folder for <name>.json and assets/ (RR_OUT, else ./recordings)
//   assetPath    URL the host serves <out>/assets from (RR_ASSET_PATH, else /replays/assets)
//   origins      public origins whose images, fonts and CSS should be saved too, e.g.
//                ['https://www.dispatchmac.com']. Localhost is always saved.
//   locale, timezoneId   for dates and numbers in the page (the machine's own by default)
export async function record(name, run, { speed = 1, viewport = { width: WIDTH, height: HEIGHT }, domCursor = false, setup, colorScheme = 'light', out = OUT, assetPath = ASSET_PATH, origins = [], locale, timezoneId } = {}) {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme, locale, timezoneId })
  if (domCursor) await context.addInitScript(`window.__rrDomCursor = true;` + INIT_SCRIPT)
  await context.addInitScript(TOOLBAR_SCRIPT)
  if (setup) await setup(context)
  await context.addInitScript(RECORD_JS + ';window.rrwebRecord = window.rrwebRecord || (typeof module !== "undefined" ? module.exports : undefined);')
  const events = []
  let recording = false
  await context.exposeFunction('__rrEmit', (json) => { if (recording) events.push(JSON.parse(json)) })
  const page = await context.newPage()

  const segments = [] // { start, end, factor } in ms, page clock
  const cuts = []
  let pos = { x: viewport.width / 2, y: viewport.height / 2 }
  const now = () => Date.now()

  const r = {
    page,
    errors: [],
    async goto(url) { await page.goto(url.startsWith('http') ? url : BASE + url); await page.waitForLoadState('networkidle').catch(() => {}) },
    // Recording starts here, not at goto: set the scene first (scroll, open panels, hide things)
    async start() {
      recording = true
      // Record this page now, and every page it navigates to
      await page.evaluate(START_RECORDING)
      await context.addInitScript(`document.addEventListener('DOMContentLoaded', () => ${START_RECORDING.replace(/^\(\(\) => /, '(() => ')} )`)
      await page.mouse.move(pos.x, pos.y)
      await page.waitForTimeout(200)
    },
    async wait(ms) { await page.waitForTimeout(ms) },
    async css(text) { await page.addStyleTag({ content: text }) },
    // Glide the cursor to a locator's centre or to { x, y }
    async moveTo(target, { duration = 650 } = {}) {
      let to
      if (typeof target.boundingBox === 'function') {
        await target.scrollIntoViewIfNeeded().catch(() => {})
        const box = await target.boundingBox()
        if (!box) throw new Error('moveTo: target not visible')
        to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      } else to = target
      const steps = Math.max(8, Math.round(duration / 16))
      const from = { ...pos }
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps)
        await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
        await page.waitForTimeout(duration / steps)
      }
      pos = to
    },
    // Move, press, then hold `after` ms (450) so the result can be seen
    async click(target, opts = {}) {
      await r.moveTo(target, opts)
      await page.waitForTimeout(140)
      await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up()
      await page.waitForTimeout(opts.after ?? 450)
    },
    async type(target, text, { delay = 28 } = {}) {
      await r.click(target, { after: 150 })
      await page.keyboard.type(text, { delay })
    },
    async scroll(deltaY, { duration = 700 } = {}) {
      const steps = Math.max(6, Math.round(duration / 16))
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, deltaY / steps); await page.waitForTimeout(duration / steps) }
      await page.waitForTimeout(150)
    },
    // Whatever happens inside is cut from the recording (a slow load, a navigation)
    async cut(fn) {
      const start = now()
      await fn()
      await page.waitForTimeout(400)
      cuts.push({ start, end: now() })
      await page.mouse.move(pos.x + 1, pos.y); await page.mouse.move(pos.x, pos.y)
    },
    // Whatever happens inside plays `factor` times faster (an AI response streaming in)
    async fast(factor, fn) {
      const start = now()
      const result = await fn()
      segments.push({ start, end: now(), factor })
      return result
    },
    // Spotlight: the region the player should crop to, in CSS px (saved as meta.region)
    async focus(target, { pad = 0 } = {}) {
      const box = typeof target.boundingBox === 'function' ? await target.boundingBox() : target
      r.region = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
      return r.region
    },
  }
  page.on('pageerror', (e) => r.errors.push(String(e).slice(0, 200)))

  try {
    await run(r)
    await page.waitForTimeout(400)
  } finally {
    recording = false
    await browser.close()
  }
  if (!events.length) throw new Error(`${name}: no events recorded (did the script call r.start()?)`)

  // Retime: drop cut stretches (keeping the new page's snapshot), speed up fast() waits
  const t0 = events[0].timestamp
  const shift = (t) => {
    let o = t - t0
    for (const c of cuts) o -= Math.max(0, Math.min(t, c.end) - c.start) * (t > c.start ? 1 : 0)
    for (const s of segments) {
      const inside = Math.max(0, Math.min(t, s.end) - s.start)
      o -= inside * (1 - 1 / s.factor)
    }
    return o / speed
  }
  // Events inside a cut collapse onto its end, so the next page's full snapshot still lands
  const retimed = fixValues(events.map((e) => ({ ...e, timestamp: Math.round(shift(e.timestamp)) + 1000000 })))
  retimed.sort((a, b) => a.timestamp - b.timestamp)
  const file = path.join(out, `${name}.json`)
  const meta = { name, width: viewport.width, height: viewport.height, mouse: !domCursor, region: r.region ?? null, duration: retimed.at(-1).timestamp - retimed[0].timestamp }
  // Assets the page loaded, saved next to the recordings and re-pointed at assetPath
  const json = await localise(JSON.stringify({ meta, events: retimed }), out, { assetPath, origins })
  fs.writeFileSync(file, json)
  console.log(JSON.stringify({ name, out: file, seconds: +(meta.duration / 1000).toFixed(1), events: retimed.length, kb: Math.round(fs.statSync(file).size / 1024), errors: r.errors }))
  return file
}
