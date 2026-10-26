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
//     zooms:    [{ id, start, end, region, move, highlight }],
//               region and highlight ({ x, y, width, height, label }) in recorded px,
//               move = ms the camera takes to get there
//     captions: [{ id, start, end, text }],
//   }
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

  globalThis.HtmlRecordingEdits = { EASE, empty, segments, editedDuration, toEdited, toRaw, zoomAt, captionAt, fit, transformFor, toAspect, Driver }
})()
