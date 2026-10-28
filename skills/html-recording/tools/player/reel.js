// Sizzle reels: a feature told as text, then demonstration, then the next. Cursor's format: an
// opener, then a chapter card ("Leave comments for your agents") and a demo of exactly that,
// repeated, then the logo. Hard cuts between scenes; the motion lives inside the demos.
//
// A reel is <name>.reel.json beside the recordings it uses:
//   {
//     version: 1,
//     shape: '16:9' | '1:1' | '9:16',
//     background: 'dusk' | 'sand' | 'ink' | 'brand',   what the demo windows float on
//     cards: 'light' | 'dark',
//     brand: { mark: <image URL> | null },
//     scenes: [
//       { id, type: 'opener', title, sub, duration },
//       { id, type: 'card', text, duration },
//       { id, type: 'demo', take: 'clip.json', from, to, window },  from/to in raw ms of the take;
//                                         plays through the take's studio edit (zooms that follow
//                                         the mouse, cuts, speed); window = share of the width
//       { id, type: 'outro', text, duration },
//     ],
//   }
//
// A plain script, like edits.js (which it needs, with rrweb-replay): sets globalThis.HtmlReel and
// defines <html-reel src="x.reel.json" controls>. Reel.render(t) draws any moment exactly, so the
// same code plays live, scrubs in the studio and renders frame by frame to MP4.
;(() => {
  const SHAPES = {
    '16:9': { width: 1920, height: 1080, use: 'X and LinkedIn posts, YouTube, a website hero' },
    '1:1': { width: 1080, height: 1080, use: 'LinkedIn and Instagram feeds' },
    '9:16': { width: 1080, height: 1920, use: 'Stories, Reels, TikTok and Shorts' },
  }
  const BACKGROUNDS = {
    dusk: 'radial-gradient(120% 90% at 20% 0%, #F2C9A6 0%, #D9AE97 28%, #6F8A88 55%, #3E6F75 72%, #1C3A44 100%)',
    sand: 'linear-gradient(160deg, #F7E7D6 0%, #E8C9A8 100%)',
    ink: 'linear-gradient(160deg, #3A3A3A 0%, #0E0E0E 100%)',
    brand: 'linear-gradient(160deg, #2D7DC2 0%, #0F3758 100%)',
  }
  const DEFAULTS = { opener: 3000, card: 2000, outro: 2500 }
  const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
  const ARROW = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 3l14 8.5-6.2 1.4L16.5 20l-2.8 1.3-3.6-7.1L5 18z' fill='%23111' stroke='%23fff' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E")`
  const CSS = `
    .hreel-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
    .hreel-scene { position: absolute; inset: 0; display: none; }
    .hreel-scene.on { display: block; }
    .hreel-card { display: none; align-items: center; justify-content: center; flex-direction: column; text-align: center; padding: 0 12%; }
    .hreel-card.on { display: flex; }
    .hreel-text { will-change: opacity, transform, filter; }
    .hreel-window { position: absolute; overflow: hidden; border-radius: 18px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 50px 100px rgba(10,25,30,.45); }
    .hreel-bar { height: 38px; display: flex; align-items: center; gap: 9px; padding: 0 16px; background: #f4f4f5; border-bottom: 1px solid rgba(0,0,0,.06); }
    .hreel-bar i { width: 12px; height: 12px; border-radius: 50%; background: #d4d4d8; }
    .hreel-view { position: relative; overflow: hidden; }
    .hreel-cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    .hreel-cam .replayer-wrapper { position: relative; }
    .hreel-cam iframe { border: 0; display: block; pointer-events: none; }
    .hreel-cam .replayer-mouse-tail { display: none; }
    .hreel-cam .replayer-mouse { position: absolute; z-index: 10; width: 22px; height: 22px; margin: -3px 0 0 -4px; pointer-events: none; border: 0; border-radius: 0;
      background: ${ARROW} no-repeat center / contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    .hreel-cam .replayer-mouse::after { display: none; }
    .hreel-mark { position: absolute; z-index: 5; border-radius: 3px; background: rgba(255, 214, 0, .38); mix-blend-mode: multiply; opacity: 0; pointer-events: none; }
  `
  let styled = false
  const style = () => {
    if (styled) return
    styled = true
    const s = document.createElement('style')
    s.textContent = CSS
    document.head.appendChild(s)
  }

  const el = (tag, cls, css) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (css) Object.assign(e.style, css)
    return e
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const easeOut = (t) => 1 - Math.pow(1 - t, 3)

  // A demo plays the part of its take between from and to, through the take's own edit
  function demoEdit(scene, rec) {
    const E = globalThis.HtmlRecordingEdits
    const base = rec.edit || E.empty(rec.meta.duration)
    const t = base.trim || { start: 0, end: rec.meta.duration }
    const start = Math.max(t.start, scene.from ?? t.start)
    const end = Math.min(t.end, scene.to ?? t.end)
    return { ...E.empty(rec.meta.duration), ...base, trim: { start, end: Math.max(start + 100, end) } }
  }

  // Where each scene sits on the reel's clock. Demos last as long as their edited part of the take.
  function timeline(reel, takes) {
    const E = globalThis.HtmlRecordingEdits
    let at = 0
    return (reel.scenes || []).map((scene) => {
      let duration = scene.duration ?? DEFAULTS[scene.type] ?? 2000
      let segs = null
      if (scene.type === 'demo') {
        const rec = takes[scene.take]
        if (rec) {
          segs = E.segments(demoEdit(scene, rec), rec.meta.duration)
          duration = E.editedDuration(segs)
        } else duration = 0
      }
      const item = { scene, start: at, duration, segs }
      at += duration
      return item
    })
  }

  class Reel {
    // root: an element to draw into. takes: { [scene.take]: { meta, events, edit? } }
    constructor(root, reel, takes, { Replayer } = {}) {
      style()
      this.root = root
      this.takes = takes
      this.Replayer = Replayer || globalThis.rrwebReplay?.Replayer
      this.t = 0
      this.playing = false
      this.stage = el('div', 'hreel-stage')
      root.appendChild(this.stage)
      this.setReel(reel)
    }
    setReel(reel) {
      this.reel = reel
      this.shape = SHAPES[reel.shape] || SHAPES['16:9']
      this.items = timeline(reel, this.takes)
      this.length = this.items.length ? this.items.at(-1).start + this.items.at(-1).duration : 0
      Object.assign(this.stage.style, { width: this.shape.width + 'px', height: this.shape.height + 'px' })
      this.build()
      this.fit()
      this.render(Math.min(this.t, this.length), true)
    }
    setTakes(takes) { this.takes = takes; this.setReel(this.reel) }
    // Scale the stage to the root's width
    fit() {
      const w = this.root.clientWidth || this.shape.width
      this.scale = w / this.shape.width
      this.stage.style.transform = `scale(${this.scale})`
      this.root.style.height = this.shape.height * this.scale + 'px'
    }
    // Scene nodes stay where they are in the stage (moving a replay's iframe reloads it blank):
    // a scene is rebuilt only when it, or a reel setting it depends on, changes
    build() {
      const prev = this.nodes || new Map()
      const next = new Map()
      for (const item of this.items) {
        const { scene } = item
        const rec = scene.type === 'demo' ? this.takes[scene.take] : null
        const key = JSON.stringify([scene, this.reel.shape, scene.type === 'demo' ? this.reel.background : this.reel.cards, this.reel.brand, rec ? [rec.meta.name, rec.meta.duration, rec.edit] : null])
        let entry = prev.get(scene.id)
        if (!entry || entry.key !== key || next.has(scene.id)) {
          if (entry && !next.has(scene.id)) this.drop(entry)
          entry = { key }
          if (scene.type === 'demo') Object.assign(entry, this.demoNode(scene))
          else entry.node = this.cardNode(scene)
          if (entry.node.parentNode !== this.stage) this.stage.appendChild(entry.node)
        }
        next.set(scene.id, entry)
        item.node = entry.node
        item.demo = entry.demo
      }
      for (const [id, entry] of prev) if (next.get(id) !== entry) this.drop(entry)
      this.nodes = next
    }
    drop(entry) {
      // rrweb's destroy() can throw once its wrapper has left the page; the node goes either way
      try { entry.demo?.driver?.destroy() } catch {}
      try { entry.demo?.replayer?.destroy() } catch {}
      entry.node?.remove()
    }
    cardNode(scene) {
      const dark = (this.reel.cards || 'light') === 'dark'
      const W = this.shape.width
      const ink = dark ? '#ffffff' : '#111111'
      const node = el('div', 'hreel-scene hreel-card', { background: scene.type === 'outro' ? '#000' : dark ? '#0b0b0b' : '#ffffff' })
      const text = el('div', 'hreel-text', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: W * 0.012 + 'px' })
      const mark = () => {
        const size = W * (scene.type === 'outro' ? 0.04 : 0.034)
        const fg = scene.type === 'outro' || dark ? '#fff' : '#111'
        if (this.reel.brand?.mark) {
          const img = el('img', '', { width: size + 'px', height: size + 'px', objectFit: 'contain' })
          img.src = this.reel.brand.mark
          return img
        }
        const m = el('div', '', { width: size + 'px', height: size + 'px', borderRadius: size * 0.26 + 'px', background: fg, display: 'grid', placeItems: 'center' })
        m.appendChild(el('div', '', { width: size * 0.4 + 'px', height: size * 0.4 + 'px', borderRadius: '50%', background: fg === '#fff' ? '#000' : '#fff' }))
        return m
      }
      const line = (s, color, size, weight) => {
        const d = el('div', '', { color, fontSize: size + 'px', lineHeight: 1.25, fontWeight: weight, letterSpacing: '-0.01em' })
        d.textContent = s || ''
        return d
      }
      if (scene.type === 'opener') {
        text.appendChild(mark())
        const words = el('div', '', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: W * 0.008 + 'px' })
        words.appendChild(line(scene.title, ink, W * 0.026, 500))
        if (scene.sub) words.appendChild(line(scene.sub, '#8a8a8a', W * 0.026, 500))
        text.appendChild(words)
      } else if (scene.type === 'outro') {
        text.appendChild(mark())
        if (scene.text) text.appendChild(line(scene.text, '#8a8a8a', W * 0.0145, 500))
      } else {
        text.appendChild(line(scene.text, ink, W * 0.029, 400))
      }
      node.appendChild(text)
      node._text = text
      return node
    }
    demoNode(scene) {
      const E = globalThis.HtmlRecordingEdits
      const rec = this.takes[scene.take]
      const node = el('div', 'hreel-scene', { background: BACKGROUNDS[this.reel.background] || BACKGROUNDS.dusk })
      if (!rec) return { node }
      const { width: W, height: H } = this.shape
      const edit = demoEdit(scene, rec)
      const view = edit.crop || { x: 0, y: 0, width: rec.meta.width, height: rec.meta.height }
      // The window: a share of the stage's width, the take's shape, never taller than 86% of it
      const bar = 38
      let ww = W * (scene.window ?? (W > H ? 0.74 : 0.86))
      let vh = ww * (view.height / view.width)
      if (vh + bar > H * 0.86) { vh = H * 0.86 - bar; ww = vh * (view.width / view.height) }
      const win = el('div', 'hreel-window', { left: (W - ww) / 2 + 'px', top: (H - vh - bar) / 2 + 'px', width: ww + 'px', height: vh + bar + 'px' })
      const b = el('div', 'hreel-bar')
      b.append(el('i'), el('i'), el('i'))
      const vp = el('div', 'hreel-view', { width: ww + 'px', height: vh + 'px' })
      const cam = el('div', 'hreel-cam', { width: rec.meta.width + 'px', height: rec.meta.height + 'px' })
      const mount = el('div')
      const mark = el('div', 'hreel-mark')
      cam.append(mount, mark)
      vp.appendChild(cam)
      win.append(b, vp)
      node.appendChild(win)
      // The node goes into the stage before the replayer builds its iframe in it
      this.stage.appendChild(node)
      const replayer = new this.Replayer(rec.events, { root: mount, mouseTail: false, showWarning: false, triggerFocus: false, UNSAFE_replayCanvas: false })
      const d = { replayer, cam, mark, vp: { width: ww, height: vh } }
      d.camera = new E.Camera({ view, edit, track: E.cursorTrack(rec.events) })
      d.driver = new E.Driver(replayer, { duration: rec.meta.duration, edit, onFrame: (raw) => this.frame(d, raw) })
      replayer.pause(edit.trim.start)
      return { node, demo: d }
    }
    // A demo's camera, highlight and caption-free frame at raw time
    frame(d, raw) {
      const E = globalThis.HtmlRecordingEdits
      const shot = d.camera.at(raw)
      d.cam.style.transform = E.transformFor(shot.region, d.vp.width, d.vp.height)
      const h = shot.zoom?.highlight
      if (h) Object.assign(d.mark.style, { left: h.x + 'px', top: h.y + 'px', width: h.width + 'px', height: h.height + 'px' })
      d.mark.style.opacity = h ? String(Math.max(0, shot.amount * 2 - 1)) : '0'
    }
    itemAt(t) {
      for (const item of this.items) if (t < item.start + item.duration) return item
      return this.items.at(-1)
    }
    // Draw the reel exactly as it is at t (ms). Scrubbing and rendering to video use this.
    render(t, instant) {
      this.t = Math.max(0, Math.min(this.length, t))
      const item = this.itemAt(this.t)
      if (!item) return
      for (const i of this.items) i.node.classList.toggle('on', i === item)
      const local = this.t - item.start
      if (item.node._text) {
        // Text arrives over 450 ms: up a little, out of a slight blur
        const k = easeOut(clamp01(local / 450))
        Object.assign(item.node._text.style, { opacity: String(k), transform: `translateY(${(1 - k) * 14}px)`, filter: `blur(${(1 - k) * 6}px)` })
      }
      if (item.demo) {
        const E = globalThis.HtmlRecordingEdits
        const raw = E.toRaw(item.segs, local)
        item.demo.driver.pause(raw)
        this.frame(item.demo, raw)
      }
      if (this.current !== item) this.current = item
      this.onTime?.(this.t)
    }
    // Live: cards on the wall clock, demos on their replayer's own clock
    play(from = this.t) {
      if (from >= this.length - 1) from = 0
      this.pause()
      this.playing = true
      this.render(from)
      let item = this.current
      let base = performance.now() - (from - item.start)
      if (item.demo) item.demo.driver.play(from - item.start)
      const tick = () => {
        if (!this.playing) return
        const local = item.demo ? item.demo.driver.edited() : performance.now() - base
        if (local >= item.duration - 8 || (item.demo && !item.demo.driver.playing)) {
          const next = this.items[this.items.indexOf(item) + 1]
          item.demo?.driver.pause()
          if (!next) { this.render(this.length); this.playing = false; this.onFinish?.(); return }
          item = next
          this.render(next.start)
          base = performance.now()
          if (item.demo) item.demo.driver.play(0)
        } else if (item.node._text) {
          this.render(item.start + local)
        } else {
          this.t = item.start + local
          this.onTime?.(this.t)
        }
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
    }
    pause() {
      this.playing = false
      cancelAnimationFrame(this.raf)
      this.current?.demo?.driver.pause()
    }
    seek(t) { const was = this.playing; this.pause(); this.render(t); if (was) this.play(t) }
    destroy() { this.pause(); for (const entry of this.nodes?.values() || []) this.drop(entry); this.stage.remove() }
  }

  // <html-reel src="x.reel.json" controls>: plays a reel anywhere. Takes are fetched beside the
  // reel (with their <name>.edit.json when there is one), or read from reel.takes when exported.
  if (typeof customElements !== 'undefined' && !customElements.get('html-reel')) {
    const HERE = document.currentScript?.src || location.href
    const script = (file, global) => window[global] ? Promise.resolve(window[global]) : new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = new URL(file, HERE).href
      s.onload = () => res(window[global])
      s.onerror = rej
      document.head.appendChild(s)
    })
    customElements.define('html-reel', class extends HTMLElement {
      async connectedCallback() {
        this.style.display = 'block'
        this.style.position = 'relative'
        const box = el('div', '', { position: 'relative', width: '100%', overflow: 'hidden', borderRadius: '12px' })
        this.appendChild(box)
        const src = this.getAttribute('src')
        const reel = src.startsWith('#') ? JSON.parse(document.querySelector(src).textContent) : await (await fetch(src)).json()
        await Promise.all([script('rrweb-replay.min.js', 'rrwebReplay'), script('edits.js', 'HtmlRecordingEdits')])
        const base = src.startsWith('#') ? location.href : new URL(src, location.href).href
        const takes = { ...(reel.takes || {}) }
        await Promise.all([...new Set(reel.scenes.filter((s) => s.type === 'demo').map((s) => s.take))].map(async (take) => {
          if (takes[take]) return
          const url = new URL(take, base)
          const rec = await (await fetch(url)).json()
          if (!rec.edit) rec.edit = await fetch(url.href.replace(/\.json$/, '.edit.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          takes[take] = rec
        }))
        this.reel = new Reel(box, reel, takes)
        new ResizeObserver(() => this.reel.fit()).observe(box)
        const loop = () => setTimeout(() => this.reel?.play(0), 1200)
        this.reel.onFinish = loop
        if (this.hasAttribute('controls')) this.controls()
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.reel.play(0)
      }
      disconnectedCallback() { this.reel?.destroy() }
      controls() {
        const c = el('div', '', { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', font: '12px system-ui, sans-serif' })
        const btn = el('button', '', { font: 'inherit', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer' })
        const range = el('input', '', { flex: '1' })
        Object.assign(range, { type: 'range', min: 0, max: 1000, value: 0 })
        const label = el('span')
        c.append(btn, range, label)
        this.appendChild(c)
        const fmt = (ms) => (ms / 1000).toFixed(1) + 's'
        const sync = () => { btn.textContent = this.reel.playing ? 'Pause' : 'Play' }
        btn.onclick = () => { if (this.reel.playing) this.reel.pause(); else this.reel.play(); sync() }
        range.oninput = () => { this.reel.seek(range.value / 1000 * this.reel.length); sync() }
        this.reel.onTime = (t) => { range.value = Math.round(t / this.reel.length * 1000); label.textContent = `${fmt(t)} / ${fmt(this.reel.length)}`; sync() }
      }
    })
  }

  globalThis.HtmlReel = { SHAPES, BACKGROUNDS, DEFAULTS, timeline, demoEdit, Reel }
})()
