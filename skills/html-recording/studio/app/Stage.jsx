import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Replayer } from '@rrweb/replay'
import { E } from './util.js'

// What a click on the replay picks: the element under the cursor, lifted to the nearest thing a
// person would call one (a button, a row, a link) rather than the span of text inside it. Alt
// picks exactly what is under the cursor.
const MEANINGFUL = 'button, a, [role], li, tr, td, th, input, select, textarea, label, h1, h2, h3, h4, h5, p, img, svg, table, section, article, nav, aside, header, footer, form, dialog'
function pickElement(doc, x, y, exact) {
  let el = doc?.elementFromPoint(x, y)
  if (!el || el === doc.documentElement || el === doc.body) return null
  if (!exact) {
    const up = el.closest(MEANINGFUL)
    if (up && up !== doc.body && up.getBoundingClientRect().width < doc.documentElement.clientWidth * 0.9) el = up
  }
  const r = el.getBoundingClientRect()
  const role = el.getAttribute('role') || el.tagName.toLowerCase()
  const text = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48)
  return { region: { x: r.left, y: r.top, width: r.width, height: r.height }, role, text }
}

export const Stage = forwardRef(function Stage({ rec, edit, mode, selection, pick, onPick, onCancelPick, onTime, onPlaying }, ref) {
  const { meta, events } = rec
  const full = useMemo(() => ({ x: 0, y: 0, width: meta.width, height: meta.height }), [meta])
  const boxRef = useRef(null)
  const mountRef = useRef(null)
  const driver = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [raw, setRaw] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)
  const track = useMemo(() => E.cursorTrack(events), [events])

  const playEdit = useMemo(() => (mode === 'raw' ? E.empty(meta.duration) : edit), [mode, edit, meta.duration])
  const editingCrop = pick?.target === 'crop' || selection?.kind === 'crop'
  const view = mode === 'raw' || editingCrop || !edit.crop ? full : edit.crop

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  // One replayer per recording; the driver steers its clock through the edit
  useEffect(() => {
    const r = new Replayer(events, { root: mountRef.current, mouseTail: false, showWarning: false, triggerFocus: false, UNSAFE_replayCanvas: false })
    const d = new E.Driver(r, {
      duration: meta.duration,
      edit: playEdit,
      onFrame: (t) => { setRaw(t); onTime?.(t) },
      onFinish: () => { setPlaying(false); onPlaying?.(false) },
    })
    driver.current = d
    r.pause(0)
    setRaw(0)
    onTime?.(0)
    return () => { d.destroy(); r.destroy(); if (mountRef.current) mountRef.current.innerHTML = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])
  useEffect(() => { driver.current?.setEdit(playEdit) }, [playEdit])

  const seekRaw = useCallback((t) => {
    const d = driver.current
    if (!d) return
    const wasPlaying = d.playing
    d.pause(Math.max(0, Math.min(meta.duration, t)))
    setRaw(d.raw())
    onTime?.(d.raw())
    if (wasPlaying) d.play()
  }, [meta.duration, onTime])

  useImperativeHandle(ref, () => ({
    play() { if (!driver.current) return; driver.current.play(); setPlaying(true); onPlaying?.(true) },
    pause() { driver.current?.pause(); setPlaying(false); onPlaying?.(false) },
    toggle() { if (driver.current?.playing) this.pause(); else this.play() },
    seekRaw,
    get playing() { return !!driver.current?.playing },
    get length() { return driver.current?.length ?? 0 },
    edited(t) { return E.toEdited(driver.current?.segs || [], t ?? raw) },
  }), [seekRaw, raw, onPlaying])

  // Fit the view (the crop, or the whole screen) into the stage
  const k = box.w && box.h ? Math.min(box.w / view.width, box.h / view.height) : 0
  const fw = Math.floor(view.width * k)
  const fh = Math.floor(view.height * k)

  // The camera: playing the edit, it is the real thing (following the mouse in follow zooms);
  // paused, the whole view shows with the camera's frame drawn on it, so zooms can be judged
  // while scrubbing
  const camera = useMemo(() => new E.Camera({ view, edit, track }), [view, edit, track])
  const shot = mode === 'edited' && !editingCrop ? camera.at(raw) : { region: view, amount: 0, zoom: null }
  const camLive = playing && mode === 'edited'
  const region = camLive ? shot.region : view
  const f = fw ? E.fit(region, fw, fh) : { scale: 1, x: 0, y: 0 }
  const cameraStyle = {
    width: meta.width,
    height: meta.height,
    transform: `scale(${f.scale}) translate(${f.x}px, ${f.y}px)`,
    '--b': `${2 / f.scale}px`,
    '--inv': 1 / f.scale,
  }

  const selectedZoom = selection?.kind === 'zoom' ? edit.zooms.find((z) => z.id === selection.id) : null
  const zoomNow = shot.zoom
  // Paused: the camera's frame at the playhead, or a fixed zoom's area when it's selected
  const frameBox = !camLive && mode === 'edited' && !editingCrop
    ? (shot.amount > 0.01 ? { region: shot.region, zoom: zoomNow } : selectedZoom && !E.follows(selectedZoom) ? { region: selectedZoom.region, zoom: selectedZoom } : null)
    : null
  const caption = mode === 'edited' ? E.captionAt(edit, raw) : null
  const markOpacity = camLive && zoomNow?.highlight ? Math.max(0, shot.amount * 2 - 1) : 0

  // Picking: pointer → recorded px
  const toRec = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const vf = E.fit(view, fw, fh)
    return { x: (e.clientX - r.left) / vf.scale - vf.x, y: (e.clientY - r.top) / vf.scale - vf.y }
  }
  const doc = () => mountRef.current?.querySelector('iframe')?.contentDocument
  const onPickMove = (e) => {
    const p = toRec(e)
    if (drag) { setDrag({ ...drag, cur: p }); return }
    setHover(pickElement(doc(), p.x, p.y, e.altKey))
  }
  const onPickDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ start: toRec(e), cur: toRec(e) })
  }
  const onPickUp = (e) => {
    const d = drag
    setDrag(null)
    if (!d) return
    const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y)
    if (w > 6 && h > 6) {
      onPick({ region: { x: Math.min(d.start.x, d.cur.x), y: Math.min(d.start.y, d.cur.y), width: w, height: h }, label: '' })
    } else {
      const hit = pickElement(doc(), d.start.x, d.start.y, e.altKey)
      if (hit) onPick({ region: hit.region, label: hit.text })
    }
    setHover(null)
  }
  useEffect(() => {
    if (!pick) { setHover(null); setDrag(null); return }
    const onKey = (e) => { if (e.key === 'Escape') onCancelPick() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, onCancelPick])

  const box4 = (r) => ({ left: r.x, top: r.y, width: r.width, height: r.height })
  const vf = fw ? E.fit(view, fw, fh) : { scale: 1, x: 0, y: 0 }
  const tipAt = hover ? { left: Math.min(fw - 200, (hover.region.x + vf.x) * vf.scale), top: Math.max(4, (hover.region.y + vf.y) * vf.scale - 30) } : null

  return (
    <div className="stage-box" ref={boxRef}>
      <div className="frame" style={{ width: fw, height: fh }}>
        <div className="camera" style={cameraStyle}>
          <div ref={mountRef} />
          {frameBox && (
            <div className={`ov zoom${frameBox.zoom === selectedZoom ? ' sel' : ''}`} style={box4(frameBox.region)}>
              <span className="tag">
                Zoom {edit.zooms.indexOf(frameBox.zoom) + 1}
                <span className="mono">{Math.round(E.scaleOf(frameBox.zoom, view) * 100)}%{E.follows(frameBox.zoom) ? ' · follows' : ''}</span>
              </span>
            </div>
          )}
          {!camLive && selectedZoom?.highlight && <div className="ov hl edit" style={box4(selectedZoom.highlight)} />}
          {camLive && zoomNow?.highlight && <div className="ov hl" style={{ ...box4(zoomNow.highlight), opacity: markOpacity }} />}
          {editingCrop && edit.crop && <div className="ov crop" style={box4(edit.crop)} />}
          {pick && hover && !drag && <div className="ov hover" style={box4(hover.region)} />}
          {pick && drag && (
            <div className="ov drawn" style={box4({ x: Math.min(drag.start.x, drag.cur.x), y: Math.min(drag.start.y, drag.cur.y), width: Math.abs(drag.cur.x - drag.start.x), height: Math.abs(drag.cur.y - drag.start.y) })} />
          )}
        </div>
        {caption && <div className="stage-caption">{caption.text}</div>}
        {pick && (
          <>
            <div className="pick-layer" onPointerMove={onPickMove} onPointerDown={onPickDown} onPointerUp={onPickUp} onPointerLeave={() => !drag && setHover(null)} />
            {hover && !drag && tipAt && (
              <div className="pick-tip" style={tipAt}>
                <span style={{ fontWeight: 500, fontSize: 12, lineHeight: '16px' }}>{hover.role}</span>
                <span className="mono dim">{Math.round(hover.region.width)} × {Math.round(hover.region.height)}</span>
              </div>
            )}
            <div className="pick-banner">
              <span>{pick.prompt}</span>
              <button className="btn sm" onClick={onCancelPick}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
