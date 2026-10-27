// Edits: what the studio changes about a recording without touching the recording itself.
// Shared by the player (<html-recording>) and the studio. A plain script: it sets
// globalThis.HtmlRecordingEdits, so it works with no build step and imports fine from a bundler.
//
// An edit, saved beside the recording as <name>.edit.json (or embedded as `edit` by export.mjs).
// Every time is in ms of the raw recording, from its first event:
//   {
//     version: 1,
//     trim:     { start, end },                      the part that plays
//     cuts:     [{ id, start, end }],                stretches skipped entirely
//     speeds:   [{ id, start, end, rate }],          stretches played faster (or slower)
//     crop:     { x, y, width, height } | null,      in recorded CSS px; the whole screen when null
//     zooms:    [{ id, start, end, scale, follow, region, move, highlight }],
//               scale = how far in (1.8 = 180%); follow = the camera follows the mouse
//               (Screen Studio style), otherwise it holds `region` (recorded px);
//               move = ms the camera takes to zoom in, and to zoom back out;
//               highlight = { x, y, width, height, label } in recorded px, or null
//     captions: [{ id, start, end, text }],
//   }
// Outside a zoom the whole view (the crop, or the screen) is in frame.
;(() => {
  const EASE = 'cubic-bezier(0.77, 0, 0.175, 1)'

  const empty = (duration) => ({ version: 1, trim: { start: 0, end: duration }, cuts: [], speeds: [], crop: null, zooms: [], captions: [] })

  // The stretches that play, in order, each with its rate and where it starts on the edited clock
  function segments(edit, duration) {
    const start = Math.max(0, edit?.trim?.start ?? 0)
    const end = Math.min(duration, edit?.trim?.end ?? duration)
    let kept = end > start ? [[start, end]] : []
    for (const cut of [...(edit?.cuts || [])].sort((a, b) => a.start - b.start)) {
      kept = kept.flatMap(([s, e]) => {
        if (cut.end <= s || cut.start >= e) return [[s, e]]
        return [[s, cut.start], [cut.end, e]].filter(([a, b]) => b - a > 1)
      })
    }
    const speeds = edit?.speeds || []
    const out = []
    let at = 0
    for (const [s, e] of kept) {
      const marks = [s, e, ...speeds.flatMap((sp) => [sp.start, sp.end]).filter((t) => t > s && t < e)].sort((a, b) => a - b)
      for (let i = 0; i < marks.length - 1; i++) {
        const a = marks[i], b = marks[i + 1]
        if (b - a < 1) continue
        const mid = (a + b) / 2
        const rate = speeds.find((sp) => sp.start <= mid && mid < sp.end)?.rate || 1
        out.push({ start: a, end: b, rate, at })
        at += (b - a) / rate
      }
    }
    return out
  }

  const editedDuration = (segs) => (segs.length ? segs.at(-1).at + (segs.at(-1).end - segs.at(-1).start) / segs.at(-1).rate : 0)

  // Raw recording time → edited clock. Times inside a cut land on where the cut ends.
  function toEdited(segs, raw) {
    for (const s of segs) {
      if (raw < s.start) return s.at
      if (raw < s.end) return s.at + (raw - s.start) / s.rate
    }
    return editedDuration(segs)
  }

  // Edited clock → raw recording time
  function toRaw(segs, t) {
    if (!segs.length) return 0
    for (const s of segs) {
      const len = (s.end - s.start) / s.rate
      if (t < s.at + len) return s.start + Math.max(0, t - s.at) * s.rate
    }
    return segs.at(-1).end
  }

  const zoomAt = (edit, raw) => (edit?.zooms || []).find((z) => z.start <= raw && raw < z.end) || null
  const captionAt = (edit, raw) => (edit?.captions || []).find((c) => c.start <= raw && raw < c.end) || null

  // Fit a region of the recording into a box: scale, then the offset that centres it
  function fit(region, boxWidth, boxHeight) {
    const scale = Math.min(boxWidth / region.width, boxHeight / region.height)
    return {
      scale,
      x: -(region.x + region.width / 2) + boxWidth / (2 * scale),
      y: -(region.y + region.height / 2) + boxHeight / (2 * scale),
    }
  }
  const transformFor = (region, boxWidth, boxHeight) => {
    const f = fit(region, boxWidth, boxHeight)
    return `scale(${f.scale}) translate(${f.x}px, ${f.y}px)`
  }

  // Grow a region to an aspect ratio about its centre, keeping it on the screen
  function toAspect(region, aspect, screen) {
    let { x, y, width, height } = region
    if (width / height < aspect) { const w = height * aspect; x -= (w - width) / 2; width = w }
    else { const h = width / aspect; y -= (h - height) / 2; height = h }
    if (screen) {
      width = Math.min(width, screen.width); height = Math.min(height, screen.height)
      x = Math.max(0, Math.min(x, screen.width - width)); y = Math.max(0, Math.min(y, screen.height - height))
    }
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
  }

  // Where the mouse was, from the recording: every mouse move and click, in ms from the start
  function cursorTrack(events) {
    const t0 = events[0]?.timestamp ?? 0
    const pts = []
    for (const e of events) {
      if (e.type !== 3) continue
      const d = e.data
      if ((d.source === 1 || d.source === 6 || d.source === 12) && d.positions) {
        for (const p of d.positions) pts.push({ t: e.timestamp - t0 + (p.timeOffset || 0), x: p.x, y: p.y })
      } else if (d.source === 2 && typeof d.x === 'number') pts.push({ t: e.timestamp - t0, x: d.x, y: d.y })
    }
    return pts.sort((a, b) => a.t - b.t)
  }
  function cursorAt(track, t) {
    if (!track.length) return null
    if (t <= track[0].t) return track[0]
    if (t >= track.at(-1).t) return track.at(-1)
    let lo = 0, hi = track.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid].t <= t) lo = mid; else hi = mid }
    const a = track[lo], b = track[hi]
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
  }

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  // A zoom's level: newer edits say it; older ones only have the region they held
  const scaleOf = (z, view) => z.scale ?? (z.region ? view.width / z.region.width : 1.8)
  const follows = (z) => z.follow ?? !z.region

  // The camera: for any moment, the part of the recording in frame. Outside zooms it is the
  // whole view. In a zoom it eases in over `move` ms, then either holds its region or follows
  // the mouse the way Screen Studio does: the cursor can wander the middle of the frame without
  // moving it (a dead zone), and when it nears an edge the camera glides after it on a
  // critically damped spring. The follow path is worked out once per zoom at 60 fps, so
  // scrubbing shows exactly what playback does.
  class Camera {
    constructor({ view, edit, track }) {
      this.view = view
      this.track = track || []
      this.paths = new Map()
      this.setEdit(edit)
    }
    setEdit(edit) { this.edit = edit; this.paths.clear() }
    setView(view) { this.view = view; this.paths.clear() }
    follow(z) {
      const { view } = this
      const s = scaleOf(z, view)
      const key = `${z.start}:${z.end}:${s}:${view.x},${view.y},${view.width},${view.height}`
      let path = this.paths.get(z.id)
      if (path?.key === key) return path
      const w = view.width / s, h = view.height / s
      const dead = { x: w * 0.22, y: h * 0.22 } // how far the cursor can drift from centre
      const keep = (c) => ({
        x: Math.max(view.x + w / 2, Math.min(view.x + view.width - w / 2, c.x)),
        y: Math.max(view.y + h / 2, Math.min(view.y + view.height - h / 2, c.y)),
      })
      const step = 1000 / 60
      const omega = 2 * Math.PI / 0.9 // the spring's response: about 0.9 s to settle
      const from = z.start, to = z.end
      const first = cursorAt(this.track, from) || { x: view.x + view.width / 2, y: view.y + view.height / 2 }
      let c = keep(first), v = { x: 0, y: 0 }
      const xs = [], ys = []
      for (let t = from; t <= to + step; t += step) {
        const p = cursorAt(this.track, t) || c
        const target = { ...c }
        if (p.x > c.x + dead.x) target.x = p.x - dead.x
        else if (p.x < c.x - dead.x) target.x = p.x + dead.x
        if (p.y > c.y + dead.y) target.y = p.y - dead.y
        else if (p.y < c.y - dead.y) target.y = p.y + dead.y
        const dt = step / 1000
        for (const k of ['x', 'y']) {
          const a = omega * omega * (target[k] - c[k]) - 2 * omega * v[k]
          v[k] += a * dt
          c[k] += v[k] * dt
        }
        c = keep(c)
        xs.push(c.x); ys.push(c.y)
      }
      path = { key, from, step, xs, ys }
      this.paths.set(z.id, path)
      return path
    }
    // { region, amount (0 = whole view, 1 = fully in), zoom }
    at(raw) {
      const { view } = this
      const z = (this.edit?.zooms || []).find((b) => b.start <= raw && raw < b.end)
      if (!z) return { region: view, amount: 0, zoom: null }
      const move = Math.max(1, z.move ?? 900)
      const amount = easeInOut(clamp01((raw - z.start) / move)) * easeInOut(clamp01((z.end - raw) / move))
      const s = scaleOf(z, view)
      let target
      if (follows(z)) {
        const p = this.follow(z)
        const i = Math.max(0, Math.min(p.xs.length - 1, Math.round((raw - p.from) / p.step)))
        target = { x: p.xs[i], y: p.ys[i] }
      } else {
        target = { x: z.region.x + z.region.width / 2, y: z.region.y + z.region.height / 2 }
      }
      // Zoom in log space so the speed of the zoom feels even; slide the centre with it
      const scale = Math.exp(Math.log(s) * amount)
      const vc = { x: view.x + view.width / 2, y: view.y + view.height / 2 }
      const cx = vc.x + (target.x - vc.x) * amount, cy = vc.y + (target.y - vc.y) * amount
      const w = view.width / scale, h = view.height / scale
      const x = Math.max(view.x, Math.min(view.x + view.width - w, cx - w / 2))
      const y = Math.max(view.y, Math.min(view.y + view.height - h, cy - h / 2))
      return { region: { x, y, width: w, height: h }, amount, zoom: z }
    }
  }

  // Plays a recording through its edit: skips cuts, changes speed per stretch, stops at the
  // trim end. The rrweb Replayer does the drawing; this only steers its clock.
  class Driver {
    constructor(replayer, { duration, edit, onFrame, onFinish }) {
      this.r = replayer
      this.duration = duration
      this.onFrame = onFrame
      this.onFinish = onFinish
      this.playing = false
      this.setEdit(edit)
    }
    setEdit(edit) {
      this.edit = edit
      this.segs = segments(edit, this.duration)
      this.length = editedDuration(this.segs)
    }
    raw() { return this.r.getCurrentTime() }
    edited() { return toEdited(this.segs, this.raw()) }
    play(from = this.edited()) {
      if (!this.segs.length) return
      if (from >= this.length - 1) from = 0
      const raw = toRaw(this.segs, from)
      this.i = Math.max(0, this.segs.findIndex((s) => raw < s.end))
      this.enter(this.i, raw)
      this.playing = true
      cancelAnimationFrame(this.frame)
      const tick = () => {
        if (!this.playing) return
        const now = this.raw()
        const seg = this.segs[this.i]
        if (now >= seg.end - 4) {
          const next = this.segs[this.i + 1]
          if (!next) { this.pause(seg.end); this.onFinish?.(); return }
          this.i++
          if (Math.abs(next.start - seg.end) > 4) this.enter(this.i, next.start)
          else this.r.setConfig({ speed: next.rate })
        }
        this.onFrame?.(this.raw(), false)
        this.frame = requestAnimationFrame(tick)
      }
      this.frame = requestAnimationFrame(tick)
    }
    enter(i, raw) {
      this.r.setConfig({ speed: this.segs[i].rate })
      this.r.play(raw)
    }
    pause(raw) {
      this.playing = false
      cancelAnimationFrame(this.frame)
      if (raw === undefined) this.r.pause()
      else this.r.pause(raw)
    }
    seek(edited) {
      this.pause(toRaw(this.segs, edited))
      this.onFrame?.(this.raw(), true)
    }
    destroy() { this.pause() }
  }

  globalThis.HtmlRecordingEdits = { EASE, empty, segments, editedDuration, toEdited, toRaw, zoomAt, captionAt, fit, transformFor, toAspect, cursorTrack, cursorAt, scaleOf, follows, Camera, Driver }
})()
