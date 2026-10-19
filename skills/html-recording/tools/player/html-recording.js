// <html-recording>: plays a recording from the HTML recorder anywhere, with no build step.
// The vanilla twin of the portfolio's RecordingReplay.tsx.
//
//   <script src="html-recording.js"></script>          (rrweb-replay.min.js sits beside it)
//   <html-recording src="clip.json"></html-recording>
//
// Attributes
//   src      URL of the recording JSON, or "#id" of a <script type="application/json"> holding it
//   region   "x,y,width,height" in recorded CSS px: crop to that part. Defaults to meta.region
//            when the recording has one; region="none" shows the whole screen
//   bar      draw a window bar of three dots above it
//   aspect   CSS aspect-ratio for the box (defaults to the region's or screen's own)
//   controls a play/pause button and scrubber under it
//
// It loads when it comes near the screen, loops after a beat, pauses off screen, and people who
// prefer less motion see its last frame.
;(() => {
  if (customElements.get('html-recording')) return
  const HERE = document.currentScript?.src || location.href
  const LIB = new URL('rrweb-replay.min.js', HERE).href
  let lib
  const loadLib = () => lib ||= window.rrwebReplay ? Promise.resolve(window.rrwebReplay) : new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = LIB
    s.onload = () => res(window.rrwebReplay)
    s.onerror = rej
    document.head.appendChild(s)
  })

  const ARROW = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 3l14 8.5-6.2 1.4L16.5 20l-2.8 1.3-3.6-7.1L5 18z' fill='%23111' stroke='%23fff' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E")`
  const CSS = `
    html-recording { display: block; }
    html-recording .hr-window { overflow: hidden; border-radius: 12px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 24px 48px -12px rgba(0,0,0,.25); }
    html-recording .hr-bar { display: flex; gap: 6px; padding: 10px 12px; background: #f4f4f5; border-bottom: 1px solid rgba(0,0,0,.06); }
    html-recording .hr-bar i { width: 10px; height: 10px; border-radius: 50%; background: rgba(0,0,0,.15); }
    html-recording .hr-box { position: relative; width: 100%; overflow: hidden; }
    html-recording .hr-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; opacity: 0; }
    html-recording .replayer-wrapper { position: relative; }
    html-recording .replayer-wrapper > iframe { border: none; display: block; pointer-events: none; }
    html-recording .replayer-mouse-tail, html-recording .replayer-mouse { display: none; }
    html-recording .hr-mouse .replayer-mouse {
      display: block; position: absolute; z-index: 10; width: 22px; height: 22px; margin: -3px 0 0 -4px; pointer-events: none;
      background: ${ARROW} no-repeat center / contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35));
      transition: left .05s linear, top .05s linear;
    }
    html-recording .hr-mouse .replayer-mouse::after {
      content: ''; position: absolute; left: 4px; top: 3px; width: 28px; height: 28px; border-radius: 50%;
      background: rgba(17,17,17,.2); opacity: 0; transform: translate(-50%, -50%) scale(.4);
    }
    html-recording .hr-mouse .replayer-mouse.active::after { animation: hr-click .35s ease-out; }
    @keyframes hr-click { from { opacity: 1; transform: translate(-50%, -50%) scale(.4) } to { opacity: 0; transform: translate(-50%, -50%) scale(1.5) } }
    html-recording .hr-controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; font: 12px system-ui, sans-serif; }
    html-recording .hr-controls button { font: inherit; padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(0,0,0,.15); background: #fff; cursor: pointer; }
    html-recording .hr-controls input { flex: 1; }
  `
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  class HtmlRecording extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `${this.hasAttribute('bar') ? '<div class="hr-bar"><i></i><i></i><i></i></div>' : ''}<div class="hr-box"><div class="hr-stage"></div></div>`
      this.innerHTML = `<div class="hr-window">${this.innerHTML}</div>`
      if (this.hasAttribute('controls')) {
        this.insertAdjacentHTML('beforeend', '<div class="hr-controls"><button type="button">Pause</button><input type="range" min="0" max="1000" value="0" aria-label="Scrub"><span></span></div>')
      }
      this.box = this.querySelector('.hr-box')
      this.stage = this.querySelector('.hr-stage')
      this.box.style.aspectRatio = this.getAttribute('aspect') || '16 / 10'
      this.visible = false
      this.io = new IntersectionObserver(([e]) => {
        this.visible = e.isIntersecting
        if (e.isIntersecting) this.start()
        else if (!this.paused) this.player?.pause()
      }, { rootMargin: '200px 0px' })
      this.io.observe(this)
      this.ro = new ResizeObserver(() => this.fit())
      this.ro.observe(this.box)
    }
    disconnectedCallback() {
      this.io?.disconnect(); this.ro?.disconnect(); clearInterval(this.tick)
      this.player?.destroy(); this.player = null
    }
    async load() {
      const src = this.getAttribute('src')
      if (src.startsWith('#')) return JSON.parse(document.querySelector(src).textContent)
      return (await fetch(src)).json()
    }
    fit() {
      if (!this.view) return
      const k = this.box.clientWidth / this.view.width
      this.stage.style.transform = `scale(${k}) translate(${-this.view.x}px, ${-this.view.y}px)`
      this.stage.style.opacity = '1'
    }
    async start() {
      if (this.player) { if (!this.paused) this.player.play(this.player.getCurrentTime()); return }
      if (this.loading) return
      this.loading = true
      const [{ Replayer }, rec] = await Promise.all([loadLib(), this.load()])
      const { meta } = rec
      const attr = this.getAttribute('region')
      const region = attr === 'none' ? null : attr ? (([x, y, width, height]) => ({ x, y, width, height }))(attr.split(',').map(Number)) : meta.region
      this.view = region || { x: 0, y: 0, width: meta.width, height: meta.height }
      if (!this.hasAttribute('aspect')) this.box.style.aspectRatio = `${this.view.width} / ${this.view.height}`
      Object.assign(this.stage.style, { width: meta.width + 'px', height: meta.height + 'px' })
      this.stage.classList.toggle('hr-mouse', !!meta.mouse)
      const r = new Replayer(rec.events, { root: this.stage, mouseTail: false, showWarning: false, triggerFocus: false, UNSAFE_replayCanvas: false })
      this.player = r
      this.duration = meta.duration
      // Loop, after a beat on the last frame
      r.on('finish', () => setTimeout(() => { if (this.visible && this.player === r && !this.paused) r.play(0) }, 1200))
      this.fit()
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.paused = true; r.pause(meta.duration) }
      else if (this.visible) r.play()
      this.wireControls()
    }
    wireControls() {
      const c = this.querySelector('.hr-controls')
      if (!c) return
      const [btn, range, label] = c.children
      const fmt = (ms) => (ms / 1000).toFixed(1) + 's'
      const sync = () => { btn.textContent = this.paused ? 'Play' : 'Pause' }
      sync()
      btn.onclick = () => {
        this.paused = !this.paused
        if (this.paused) this.player.pause()
        else this.player.play(this.player.getCurrentTime() >= this.duration ? 0 : this.player.getCurrentTime())
        sync()
      }
      range.oninput = () => { this.paused = true; sync(); this.player.pause(range.value / 1000 * this.duration) }
      this.tick = setInterval(() => {
        const t = this.player.getCurrentTime()
        if (!this.paused) range.value = Math.round(t / this.duration * 1000)
        label.textContent = `${fmt(Math.min(t, this.duration))} / ${fmt(this.duration)}`
      }, 100)
    }
  }
  customElements.define('html-recording', HtmlRecording)
})()
