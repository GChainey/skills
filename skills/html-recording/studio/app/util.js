import '../../tools/player/edits.js'

// The shared edit maths (also used by the <html-recording> player)
export const E = globalThis.HtmlRecordingEdits

export const uid = () => Math.random().toString(36).slice(2, 9)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 4250 → "0:04.2"
export function time(ms) {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
// 22100 → "0:22"
export const shortTime = (ms) => {
  const s = Math.round(Math.max(0, ms) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const regionText = (r) => (r ? `${Math.round(r.x)}, ${Math.round(r.y)} · ${Math.round(r.width)} × ${Math.round(r.height)}` : 'Whole screen')

// What happened when, from the rrweb events: clicks, new pages, scrolls and big screen changes.
// Marks on the timeline, and edges for blocks to snap to.
export function eventMarks(events) {
  const t0 = events[0]?.timestamp ?? 0
  const marks = []
  let sawMeta = false
  let lastScroll = null
  let lastChange = -Infinity
  for (const e of events) {
    const t = e.timestamp - t0
    if (e.type === 4) {
      if (sawMeta) marks.push({ kind: 'page', t })
      sawMeta = true
    } else if (e.type === 3) {
      const s = e.data.source
      if (s === 2 && e.data.type === 2) marks.push({ kind: 'click', t })
      else if (s === 3) {
        if (lastScroll && t - lastScroll.end < 400) lastScroll.end = t
        else { lastScroll = { kind: 'scroll', t, end: t }; marks.push(lastScroll) }
      } else if (s === 0 && (e.data.adds?.length || 0) >= 15 && t - lastChange > 600) {
        marks.push({ kind: 'change', t })
        lastChange = t
      }
    }
  }
  return marks
}

// The part of a recording an edit plays, before anything is changed
export const blankEdit = (duration) => E.empty(duration)
