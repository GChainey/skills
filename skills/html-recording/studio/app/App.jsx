import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, forgetRecording, loadRecording } from './api.js'
import { E, blankEdit, clamp, eventMarks, shortTime, time, uid } from './util.js'
import { Stage } from './Stage.jsx'
import { Timeline } from './Timeline.jsx'
import { Inspector, zoomFor } from './Inspector.jsx'
import { Thumb } from './Thumb.jsx'
import { ReelEditor } from './ReelEditor.jsx'

const PROMPTS = {
  zoom: 'Click what to zoom on, or drag a box',
  highlight: 'Click what to highlight',
  crop: 'Click an area to crop to, or drag a box',
}

// Old or hand-written edits may miss a list; fill them in
const normalise = (edit, duration) => {
  const base = blankEdit(duration)
  return { ...base, ...edit, trim: { ...base.trim, ...edit?.trim }, cuts: edit?.cuts || [], speeds: edit?.speeds || [], zooms: edit?.zooms || [], captions: edit?.captions || [] }
}

function Library({ recordings, folders, current, onOpen }) {
  const groups = useMemo(() => {
    const g = new Map()
    for (const r of recordings) g.set(r.folder, [...(g.get(r.folder) || []), r])
    return [...g]
  }, [recordings])
  return (
    <nav className="library" aria-label="Recordings">
      <div className="library-head"><b>Recordings</b><span title={folders.join('\n')}>{folders.map((f) => f.split('/').pop()).join(', ')}</span></div>
      {!recordings.length && <p className="empty">No recordings here yet. Ask Claude to record one, and it shows up here.</p>}
      {groups.map(([folder, list]) => (
        <div key={folder} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groups.length > 1 && <div className="folder-label">{folder}</div>}
          {list.map((r) => (
            <button key={r.id} className={`rec-row${r.id === current ? ' on' : ''}`} onClick={() => onOpen(r.id)}>
              <Thumb id={r.id} width={56} height={35} />
              <span className="tx">
                <b>{r.name}</b>
                <span className="mono">{shortTime(r.duration)}{r.edited ? ' · edited' : ''}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function App() {
  const [list, setList] = useState({ folders: [], recordings: [], reels: [] })
  const [studioView, setStudioView] = useState(() => localStorage.getItem('studio.view') || 'takes')
  useEffect(() => { localStorage.setItem('studio.view', studioView) }, [studioView])
  const [id, setId] = useState(() => decodeURIComponent(location.hash.slice(1)) || null)
  const [rec, setRec] = useState(null)
  const [edit, setEdit] = useState(null)
  const [raw, setRaw] = useState(0)
  const [mode, setMode] = useState('edited')
  const [selection, setSelection] = useState(null)
  const [pick, setPick] = useState(null)
  const [save, setSave] = useState(null)
  const [knobs, setKnobs] = useState(null)
  const [job, setJob] = useState(null)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState(null)
  const showToast = useCallback((text, action) => setToast({ text, action }), [])
  const [error, setError] = useState(null)
  const [playing, setPlaying] = useState(false)
  const stage = useRef(null)
  const history = useRef({ past: [], future: [] })
  const loaded = useRef(null)

  const refresh = useCallback(() => api.recordings().then(setList).catch((e) => setError(e.message)), [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!id && list.recordings[0]) setId(list.recordings[0].id)
  }, [id, list])
  useEffect(() => {
    const onHash = () => setId(decodeURIComponent(location.hash.slice(1)) || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Open a recording and its edit
  const open = useCallback(async (next, { fresh } = {}) => {
    if (fresh) forgetRecording(next)
    setRec(null); setEdit(null); setSelection(null); setPick(null); setSave(null); setRaw(0)
    try {
      const [r, ed] = await Promise.all([loadRecording(next), api.edit(next)])
      loaded.current = next
      history.current = { past: [], future: [] }
      setRec(r)
      setEdit(normalise(ed, r.meta.duration))
      const take = r.meta.take
      setKnobs({ glide: take?.glide ?? 650, pause: take?.pause ?? 1, width: r.meta.width, height: r.meta.height, scheme: take?.scheme || 'light' })
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => {
    if (!id) return
    if (location.hash.slice(1) !== id) window.history.replaceState(null, '', '#' + id)
    open(id)
  }, [id, open])

  // Save a moment after each change
  const firstEdit = useRef(true)
  useEffect(() => { firstEdit.current = true }, [rec])
  useEffect(() => {
    if (!edit || !id || loaded.current !== id) return
    if (firstEdit.current) { firstEdit.current = false; return }
    setSave('saving')
    const t = setTimeout(() => {
      api.saveEdit(id, edit).then(() => {
        setSave('saved')
        setList((l) => ({ ...l, recordings: l.recordings.map((r) => (r.id === id ? { ...r, edited: true } : r)) }))
      }).catch((e) => setSave(`Not saved: ${e.message}`))
    }, 450)
    return () => clearTimeout(t)
  }, [edit, id])

  // Undo: begin() records the edit before a change; a drag is one step however long it is
  const begin = useCallback(() => {
    setEdit((cur) => {
      history.current.past.push(cur)
      if (history.current.past.length > 200) history.current.past.shift()
      history.current.future = []
      return cur
    })
  }, [])
  const change = useCallback((fn) => setEdit((cur) => fn(cur)), [])
  const undo = () => { const h = history.current; if (!h.past.length) return; h.future.push(edit); setEdit(h.past.pop()) }
  const redo = () => { const h = history.current; if (!h.future.length) return; h.past.push(edit); setEdit(h.future.pop()) }

  const duration = rec?.meta.duration ?? 0
  const screen = rec ? { x: 0, y: 0, width: rec.meta.width, height: rec.meta.height } : null
  const view = edit?.crop || screen
  const playEdit = useMemo(() => (edit ? (mode === 'raw' ? blankEdit(duration) : edit) : null), [edit, mode, duration])
  const segs = useMemo(() => (playEdit ? E.segments(playEdit, duration) : []), [playEdit, duration])
  const length = E.editedDuration(segs)
  const marks = useMemo(() => (rec ? eventMarks(rec.events) : []), [rec])

  const startPick = (target, itemId) => { stage.current?.pause(); setMode('edited'); setPick({ target, id: itemId, prompt: PROMPTS[target] }) }
  const onPick = ({ region, label }) => {
    const p = pick
    setPick(null)
    begin()
    if (p.target === 'crop') change((ed) => ({ ...ed, crop: { x: Math.round(region.x), y: Math.round(region.y), width: Math.round(region.width), height: Math.round(region.height) } }))
    else if (p.target === 'zoom') {
      const area = zoomFor(region, view, screen)
      change((ed) => ({ ...ed, zooms: ed.zooms.map((z) => (z.id === p.id ? { ...z, follow: false, region: area, scale: +(view.width / area.width).toFixed(2) } : z)) }))
    }
    else change((ed) => ({ ...ed, zooms: ed.zooms.map((z) => (z.id === p.id ? { ...z, highlight: { x: Math.round(region.x), y: Math.round(region.y), width: Math.round(region.width), height: Math.round(region.height), label } } : z)) }))
  }

  // New blocks start at the playhead
  const add = useCallback((kind) => {
    if (!rec) return
    const at = Math.round(clamp(raw, 0, duration - 300))
    const item = { id: uid(), start: at }
    begin()
    if (kind === 'zoom') {
      // Screen Studio style: zoom in and follow the mouse; set an area instead in the inspector
      Object.assign(item, { end: Math.min(duration, at + 3000), scale: 1.8, follow: true, move: 900, highlight: null })
      change((ed) => ({ ...ed, zooms: [...ed.zooms, item].sort((a, b) => a.start - b.start) }))
      setSelection({ kind, id: item.id })
      return
    }
    if (kind === 'cut') Object.assign(item, { end: Math.min(duration, at + 1000) })
    if (kind === 'speed') Object.assign(item, { end: Math.min(duration, at + 2000), rate: 2 })
    if (kind === 'caption') Object.assign(item, { end: Math.min(duration, at + 2500), text: '' })
    const key = { cut: 'cuts', speed: 'speeds', caption: 'captions' }[kind]
    change((ed) => ({ ...ed, [key]: [...ed[key], item].sort((a, b) => a.start - b.start) }))
    setSelection({ kind, id: item.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, raw, duration, view, screen, begin, change])

  // Zoom on clicks: one follow zoom over each run of clicks (clicks less than 2.5 s apart), from
  // just before the first to a beat after the last, where there isn't a zoom already
  const clicks = useMemo(() => marks.filter((m) => m.kind === 'click').map((m) => m.t), [marks])
  const autoZoom = () => {
    const runs = []
    for (const t of clicks) {
      const last = runs.at(-1)
      if (last && t - last.end < 2500) last.end = t
      else runs.push({ start: t, end: t })
    }
    const lo = edit.trim.start, hi = edit.trim.end
    const fresh = runs
      .map((r) => ({ id: uid(), start: Math.round(Math.max(lo, r.start - 900)), end: Math.round(Math.min(hi, r.end + 1800)), scale: 1.8, follow: true, move: 900, highlight: null }))
      .filter((z) => z.end - z.start > 1200 && !edit.zooms.some((o) => o.start < z.end && z.start < o.end))
    if (!fresh.length) { setToast({ text: 'Every run of clicks already has a zoom' }); return }
    begin()
    change((ed) => ({ ...ed, zooms: [...ed.zooms, ...fresh].sort((a, b) => a.start - b.start) }))
    setToast({ text: `Added ${fresh.length} zoom${fresh.length > 1 ? 's' : ''} that follow the mouse` })
  }

  const remove = () => {
    const key = { zoom: 'zooms', cut: 'cuts', speed: 'speeds', caption: 'captions' }[selection?.kind]
    if (!key) return
    begin()
    change((ed) => ({ ...ed, [key]: ed[key].filter((b) => b.id !== selection.id) }))
    setSelection(null)
  }

  // Keyboard: no animation on any of these, they are used constantly
  useEffect(() => {
    const onKey = (e) => {
      if (!rec || pick) return
      if (e.target.closest?.('input, textarea')) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (k === ' ') { e.preventDefault(); stage.current?.toggle() }
      else if (k === 'z' || k === 'c' || k === 's' || k === 't') add({ z: 'zoom', c: 'cut', s: 'speed', t: 'caption' }[k])
      else if (k === 'i' || k === 'o') { begin(); change((ed) => ({ ...ed, trim: k === 'i' ? { ...ed.trim, start: Math.round(Math.min(raw, ed.trim.end - 200)) } : { ...ed.trim, end: Math.round(Math.max(raw, ed.trim.start + 200)) } })) }
      else if (k === 'backspace' || k === 'delete') remove()
      else if (k === 'escape') setSelection(null)
      else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); stage.current?.seekRaw(raw + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1000 : 100)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Re-record: run the clip's script again with the Next take knobs, then load the new take
  const current = list.recordings.find((r) => r.id === id)
  const rerecord = async () => {
    const take = rec.meta.take
    const k = {
      ...(knobs.glide !== 650 || take?.glide ? { glide: knobs.glide } : {}),
      ...(knobs.pause !== 1 || take?.pause !== 1 ? { pause: knobs.pause } : {}),
      ...(knobs.width !== rec.meta.width || knobs.height !== rec.meta.height ? { viewport: { width: knobs.width, height: knobs.height } } : {}),
      scheme: knobs.scheme,
    }
    stage.current?.pause()
    try {
      const { job: jobId } = await api.rerecord(id, k)
      setJob({ id: jobId, status: 'running', log: '' })
    } catch (e) { setToast({ text: e.message }) }
  }
  useEffect(() => {
    if (job?.status !== 'running') return
    const t = setInterval(async () => {
      const j = await api.job(job.id).catch(() => null)
      if (!j || j.status === 'running') return
      setJob(j)
      if (j.status === 'done') { setToast({ text: 'New take recorded' }); refresh(); open(id, { fresh: true }) }
    }, 700)
    return () => clearInterval(t)
  }, [job, id, open, refresh])

  // Export
  const exportSingle = async () => {
    setMenu(false)
    setToast({ text: 'Exporting…' })
    try {
      const { path } = await api.exportSingle(id)
      setToast({ text: `Saved ${path.split('/').pop()}`, action: ['Show in Finder', () => api.reveal(path)] })
    } catch (e) { setToast({ text: `Export failed: ${e.message}` }) }
  }
  // The portfolio's reels move their camera between keyframes, so a follow zoom becomes a
  // keyframe a second along its path (and one back to the whole view after it)
  const cameraKeys = () => {
    const cam = new E.Camera({ view, edit, track: E.cursorTrack(rec.events) })
    const at = (t) => +(E.toEdited(segs, t) / 1000).toFixed(2)
    const keys = []
    for (const z of edit.zooms) {
      const mark = z.highlight ? { mark: { x: z.highlight.x, y: z.highlight.y, width: z.highlight.width, height: z.highlight.height } } : {}
      for (let t = z.start + (z.move ?? 900); t < z.end - (z.move ?? 900); t += E.follows(z) ? 1000 : Infinity) {
        const r = cam.at(t).region
        keys.push({ at: at(t), region: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, ...mark })
      }
      keys.push({ at: at(z.end), region: view })
    }
    return keys
  }
  const copyForSite = async () => {
    setMenu(false)
    const at = (t) => +(E.toEdited(segs, t) / 1000).toFixed(2)
    const scene = {
      src: `/replays/${current.folder.split('/').pop()}/${current.name}.json`,
      ...(edit.crop ? { region: edit.crop } : {}),
      from: +(edit.trim.start / 1000).toFixed(2),
      to: +(edit.trim.end / 1000).toFixed(2),
      title: current.name,
      ...(edit.zooms.length ? { camera: cameraKeys() } : {}),
      ...(edit.captions.length ? { notes: edit.captions.map((c) => ({ at: at(c.start), text: c.text })) } : {}),
    }
    await navigator.clipboard.writeText(JSON.stringify(scene, null, 2))
    setToast({ text: edit.cuts.length || edit.speeds.length ? 'Copied. The site plays cuts and speed changes once it reads edit files.' : 'Copied for the portfolio' })
  }
  useEffect(() => {
    if (!toast || toast.text.endsWith('…')) return
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 2600)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!menu) return
    const close = (e) => { if (!e.target.closest('.actions')) setMenu(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const ready = rec && edit && loaded.current === id

  const modeSwitch = (
    <div className="seg sm mode" role="group" aria-label="Show">
      <button className={studioView === 'takes' ? 'on' : ''} onClick={() => setStudioView('takes')}>Takes</button>
      <button className={studioView === 'reels' ? 'on' : ''} onClick={() => { stage.current?.pause(); setStudioView('reels') }}>Reels</button>
    </div>
  )

  if (studioView === 'reels') {
    return (
      <>
        <ReelEditor
          list={list} modeSwitch={modeSwitch} refresh={refresh}
          onEditTake={(take) => { setStudioView('takes'); location.hash = take }}
          onToast={showToast}
        />
        {toast && (
          <div className="toast" role="status">
            {toast.text}
            {toast.action && <button className="btn sm" onClick={() => { toast.action[1](); setToast(null) }}>{toast.action[0]}</button>}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="studio">
      <header className="topbar">
        <div className="crumbs">
          {modeSwitch}
          {current && <span className="dim">{current.folder}</span>}
          {current && <span className="faint">/</span>}
          <b>{current?.name || 'Recording Studio'}</b>
          {save && <span className="state">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : save}</span>}
        </div>
        <div className="actions">
          <button className="btn" disabled={!ready || !current?.canRecord || job?.status === 'running'} onClick={rerecord} title={current?.canRecord ? 'Record this clip again with the Next take settings' : 'Needs a take made with the current recorder'}>
            {job?.status === 'running' ? 'Recording…' : 'Re-record'}
          </button>
          <button className="btn primary" disabled={!ready} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Export</button>
          {menu && (
            <div className="menu" role="menu">
              <button className="menu-item" role="menuitem" onClick={exportSingle}>
                Single HTML file<span>One file with the player, the recording and its edit. Opens from disk.</span>
              </button>
              <button className="menu-item" role="menuitem" onClick={copyForSite}>
                Copy for the portfolio<span>A replay scene with the crop, zooms and captions, ready to paste.</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="body">
        <Library recordings={list.recordings} folders={list.folders} current={id} onOpen={(next) => { location.hash = next }} />
        <main className="stage-col">
          {error && <p className="empty">{error}</p>}
          {ready ? (
            <>
              <Stage ref={stage} rec={rec} edit={edit} mode={mode} selection={selection} pick={pick} onPick={onPick} onCancelPick={() => setPick(null)} onTime={setRaw} onPlaying={setPlaying} />
              <div className="transport" style={{ width: '100%' }}>
                <div className="left">
                  <button className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => stage.current?.toggle()}>
                    {playing
                      ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>}
                  </button>
                  <span className="time">{time(E.toEdited(segs, raw))}</span>
                  <span className="time faint">/ {time(length)}</span>
                </div>
                <div className="seg" role="group" aria-label="Show">
                  <button className={mode === 'edited' ? 'on' : ''} onClick={() => setMode('edited')}>Edited</button>
                  <button className={mode === 'raw' ? 'on' : ''} onClick={() => setMode('raw')}>Raw take</button>
                </div>
              </div>
            </>
          ) : !error && <div className="stage-box"><span className="dim">{list.recordings.length ? 'Loading…' : ''}</span></div>}
        </main>
        {ready && knobs ? (
          <Inspector
            rec={rec} edit={edit} selection={selection} view={view} length={length}
            knobs={knobs} setKnobs={setKnobs} canRecord={!!current?.canRecord} job={job?.id && job.status !== 'done' ? job : null}
            clicks={clicks.length} onAutoZoom={autoZoom}
            onBegin={begin} onChange={change} onSelect={setSelection} onPick={startPick} onRemove={remove}
          />
        ) : <aside className="inspector" />}
      </div>

      {ready && (
        <Timeline
          id={id} rec={rec} edit={edit} marks={marks} raw={raw} selection={selection} view={view}
          onSeek={(t) => stage.current?.seekRaw(t)} onSelect={setSelection} onBegin={begin} onChange={change} onAdd={add}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.action && <button className="btn sm" onClick={() => { toast.action[1](); setToast(null) }}>{toast.action[0]}</button>}
        </div>
      )}
    </div>
  )
}
