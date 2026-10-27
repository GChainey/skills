import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Thumb } from './Thumb.jsx'
import { E, clamp } from './util.js'

const LABEL = 104
const PAD = 16
const MIN = 200 // ms: the shortest block
const SNAP_PX = 6
const STEPS = [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000]

const Plus = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
)

// The take strip: a handful of frozen frames across the recording. Memoised: it never changes
// while the playhead moves.
const Strip = memo(function Strip({ id, rec, width }) {
  const n = Math.max(3, Math.round(width / 180))
  const w = width / n
  return (
    <div className="strip">
      {Array.from({ length: n }, (_, i) => <Thumb key={i} id={id} rec={rec} at={(i + 0.5) / n} width={w} height={44} />)}
    </div>
  )
})

export function Timeline({ id, rec, edit, marks, raw, selection, view, onSeek, onSelect, onBegin, onChange, onAdd }) {
  const duration = rec.meta.duration
  const trackRef = useRef(null)
  const [W, setW] = useState(0)
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [])
  const px = W / duration // px per ms
  const xOf = (t) => t * px

  const step = STEPS.find((s) => s * px >= 64) || 60000
  const ticks = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)

  // Click on a track's empty space: move the playhead there
  const seekFrom = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.round(clamp((e.clientX - r.left) / px, 0, duration)))
    onSelect(null)
  }

  // Dragging a block (or a trim handle): move it, or pull one edge. Edges snap to the
  // playhead, to clicks and page changes, and to other blocks.
  const snapTargets = (skipId) => [
    raw, 0, duration,
    ...marks.map((m) => m.t),
    ...['zooms', 'speeds', 'captions', 'cuts'].flatMap((k) => edit[k].filter((b) => b.id !== skipId).flatMap((b) => [b.start, b.end])),
  ]
  const snap = (t, targets) => {
    let best = t, dist = SNAP_PX / px
    for (const c of targets) if (Math.abs(c - t) < dist) { best = c; dist = Math.abs(c - t) }
    return best
  }
  const startDrag = (e, list, item, mode) => {
    e.stopPropagation()
    e.preventDefault()
    if (list) onSelect({ kind: list.kind, id: item.id })
    e.currentTarget.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const orig = { start: item.start, end: item.end }
    const targets = snapTargets(item.id)
    let begun = false
    const move = (ev) => {
      const dt = (ev.clientX - x0) / px
      if (!begun) { if (Math.abs(ev.clientX - x0) < 2) return; begun = true; onBegin() }
      let start = orig.start, end = orig.end
      if (mode === 'move') {
        const len = end - start
        start = clamp(orig.start + dt, 0, duration - len)
        const s1 = snap(start, targets), s2 = snap(start + len, targets) - len
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2
        end = start + len
      } else if (mode === 'start') start = clamp(snap(orig.start + dt, targets), 0, end - MIN)
      else end = clamp(snap(orig.end + dt, targets), start + MIN, duration)
      start = Math.round(start); end = Math.round(end)
      if (list) onChange((ed) => ({ ...ed, [list.key]: ed[list.key].map((b) => (b.id === item.id ? { ...b, start, end } : b)) }))
      else onChange((ed) => ({ ...ed, trim: { start, end } }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const isSel = (kind, b) => selection?.kind === kind && selection.id === b.id
  // A plain function, not a component, so blocks keep their DOM while they are dragged
  const block = (kind, listKey, b, children) => (
    <div
      key={b.id}
      className={`block ${kind}${isSel(kind, b) ? ' sel' : ''}`}
      style={{ left: xOf(b.start), width: Math.max(6, xOf(b.end - b.start)) }}
      onPointerDown={(e) => startDrag(e, { kind, key: listKey }, b, 'move')}
    >
      {children}
      <span className="edge l" onPointerDown={(e) => startDrag(e, { kind, key: listKey }, b, 'start')} />
      <span className="edge r" onPointerDown={(e) => startDrag(e, { kind, key: listKey }, b, 'end')} />
    </div>
  )
  const trim = edit.trim
  const trimItem = { id: 'trim', start: trim.start, end: trim.end }

  return (
    <div className="timeline">
      <div className="lane">
        <span />
        <div className="track ruler" ref={trackRef} onPointerDown={seekFrom}>
          {ticks.map((t) => <span key={t} className="tick" style={{ left: xOf(t) }}>{t % 1000 ? (t / 1000).toFixed(1) : t / 1000}s</span>)}
        </div>
      </div>

      <div className="lane">
        <span className="lane-label">Take<button className="add" title="Cut from the playhead (C)" onClick={() => onAdd('cut')}><Plus /></button></span>
        <div className="track take" onPointerDown={seekFrom}>
          {W > 0 && <Strip id={id} rec={rec} width={W} />}
          <div className="trimmed" style={{ left: 0, width: xOf(trim.start) }} />
          <div className="trimmed" style={{ left: xOf(trim.end), right: 0 }} />
          {edit.cuts.map((b) => block('cut', 'cuts', b))}
          <div className="handle in" style={{ left: xOf(trim.start) }} onPointerDown={(e) => startDrag(e, null, trimItem, 'start')} title="Trim the start (I)" />
          <div className="handle out" style={{ left: xOf(trim.end) - 8 }} onPointerDown={(e) => startDrag(e, null, trimItem, 'end')} title="Trim the end (O)" />
        </div>
      </div>

      <div className="lane">
        <span className="lane-label">Events</span>
        <div className="track events" onPointerDown={seekFrom}>
          {marks.map((m, i) => (
            <span key={i} className={`mark ${m.kind}`} style={{ left: xOf(m.t), width: m.kind === 'scroll' ? Math.max(6, xOf(m.end - m.t)) : undefined }} />
          ))}
        </div>
      </div>

      <div className="lane">
        <span className="lane-label">Zoom<button className="add" title="Zoom at the playhead (Z)" onClick={() => onAdd('zoom')}><Plus /></button></span>
        <div className="track" onPointerDown={seekFrom}>
          {edit.zooms.map((b) => block('zoom', 'zooms', b, `${Math.round(E.scaleOf(b, view) * 100)}%${E.follows(b) ? '' : ' · area'}`))}
        </div>
      </div>

      <div className="lane">
        <span className="lane-label">Speed<button className="add" title="Speed up from the playhead (S)" onClick={() => onAdd('speed')}><Plus /></button></span>
        <div className="track" onPointerDown={seekFrom}>
          {edit.speeds.map((b) => block('speed', 'speeds', b, `${b.rate}×`))}
        </div>
      </div>

      <div className="lane">
        <span className="lane-label">Captions<button className="add" title="Caption at the playhead (T)" onClick={() => onAdd('caption')}><Plus /></button></span>
        <div className="track" onPointerDown={seekFrom}>
          {edit.captions.map((b) => block('caption', 'captions', b, b.text || 'Caption'))}
        </div>
      </div>

      {W > 0 && <div className="playhead" style={{ left: PAD + LABEL + xOf(raw) }}><i /><b /></div>}
    </div>
  )
}
