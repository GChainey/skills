import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Replayer } from '@rrweb/replay'
import '../../tools/player/reel.js'
import { api, loadRecording } from './api.js'
import { clamp, time, uid } from './util.js'

// The shared reel engine (also behind <html-reel> and the MP4 renderer)
const R = globalThis.HtmlReel

// Paths in a reel are relative to the reel file
const norm = (p) => '/' + p.split('/').reduce((out, part) => (part === '..' ? out.slice(0, -1) : part && part !== '.' ? [...out, part] : out), []).join('/')
const resolve = (dir, rel) => norm(`${dir}/${rel}`)
function relative(dir, file) {
  const a = dir.split('/').filter(Boolean), b = file.split('/').filter(Boolean)
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

const LABEL = { opener: 'Opener', card: 'Card', demo: 'Demo', outro: 'Outro' }

function Slider({ label, value, display, min, max, step, onChange }) {
  return (
    <div className="field">
      <div className="field-row"><span>{label}</span><span className="mono">{display}</span></div>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} style={{ '--p': `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Seg({ options, value, onChange }) {
  return (
    <div className="seg sm">
      {options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

function Mini({ scene }) {
  if (scene.type === 'demo') {
    return <span className="scene-mini demo" style={{ background: R.BACKGROUNDS.dusk }}><i /></span>
  }
  return <span className={`scene-mini ${scene.type}`}><i /></span>
}

export function ReelEditor({ list, modeSwitch, onEditTake, onToast, refresh }) {
  const reels = list.reels || []
  const [id, setId] = useState(() => localStorage.getItem('studio.reel') || null)
  const [reel, setReel] = useState(null)
  const [dir, setDir] = useState(null)
  const [takes, setTakes] = useState({})
  const [sel, setSel] = useState(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [save, setSave] = useState(null)
  const [job, setJob] = useState(null)
  const engine = useRef(null)
  const previewBox = useRef(null)
  const root = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const loaded = useRef(null)

  useEffect(() => { if ((!id || !reels.some((r) => r.id === id)) && reels[0]) setId(reels[0].id) }, [id, reels])
  useEffect(() => { if (id) localStorage.setItem('studio.reel', id) }, [id])

  // Open a reel, then every take its demos use (with their studio edits)
  useEffect(() => {
    if (!id) return
    let alive = true
    setReel(null); setTakes({}); setSel(null); setSave(null)
    api.reel(id).then(async ({ reel: r, dir: d }) => {
      if (!alive) return
      loaded.current = id
      setDir(d)
      setReel(r)
    }).catch((e) => onToast(e.message))
    return () => { alive = false }
  }, [id, onToast])

  const idForTake = useCallback((take) => list.recordings.find((r) => r.file === resolve(dir, take))?.id, [list.recordings, dir])
  const needed = useMemo(() => [...new Set((reel?.scenes || []).filter((s) => s.type === 'demo').map((s) => s.take))], [reel])
  useEffect(() => {
    if (!dir) return
    const missing = needed.filter((k) => !takes[k] && idForTake(k))
    if (!missing.length) return
    Promise.all(missing.map(async (k) => {
      const rid = idForTake(k)
      const [rec, edit] = await Promise.all([loadRecording(rid), api.edit(rid)])
      return [k, { ...rec, edit }]
    })).then((pairs) => setTakes((cur) => ({ ...cur, ...Object.fromEntries(pairs) })))
  }, [needed, takes, dir, idForTake])

  // Save a moment after each change
  const first = useRef(true)
  useEffect(() => { first.current = true }, [id])
  useEffect(() => {
    if (!reel || loaded.current !== id) return
    if (first.current) { first.current = false; return }
    setSave('saving')
    const tm = setTimeout(() => api.saveReel(id, reel).then(() => setSave('saved')).catch((e) => setSave(`Not saved: ${e.message}`)), 450)
    return () => clearTimeout(tm)
  }, [reel, id])

  const ready = reel && needed.every((k) => takes[k] || !idForTake(k))

  // The preview: the real reel engine, sized to fit
  useLayoutEffect(() => {
    if (!previewBox.current) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(previewBox.current)
    return () => ro.disconnect()
  }, [ready])
  const shape = R.SHAPES[reel?.shape] || R.SHAPES['16:9']
  const pw = Math.floor(Math.min(box.w, box.h * (shape.width / shape.height)))
  useEffect(() => {
    if (!ready || !root.current) return
    if (!engine.current) {
      engine.current = new R.Reel(root.current, reel, takes, { Replayer })
      engine.current.onTime = setT
      engine.current.onFinish = () => setPlaying(false)
    } else {
      engine.current.takes = takes
      engine.current.setReel(reel)
    }
  }, [ready, reel, takes])
  useEffect(() => () => { engine.current?.destroy(); engine.current = null }, [id])
  useEffect(() => { engine.current?.fit() }, [pw])

  const items = useMemo(() => (reel ? R.timeline(reel, takes) : []), [reel, takes])
  const length = items.length ? items.at(-1).start + items.at(-1).duration : 0
  const current = items.find((i) => t < i.start + i.duration) || items.at(-1)
  const play = () => { if (!engine.current) return; if (engine.current.playing) { engine.current.pause(); setPlaying(false) } else { engine.current.play(); setPlaying(true) } }
  const seek = (ms) => { engine.current?.seek(clamp(ms, 0, length)) }
  const select = (sid) => {
    setSel(sid)
    const item = items.find((i) => i.scene.id === sid)
    if (item && !engine.current?.playing) seek(item.start + Math.min(500, item.duration / 2))
  }

  const scenes = reel?.scenes || []
  const scene = scenes.find((s) => s.id === sel)
  const patch = (changes) => setReel((r) => ({ ...r, scenes: r.scenes.map((s) => (s.id === sel ? { ...s, ...changes } : s)) }))
  const setOpt = (changes) => setReel((r) => ({ ...r, ...changes }))
  const insert = (s) => {
    const at = sel ? scenes.findIndex((x) => x.id === sel) + 1 : Math.max(0, scenes.findIndex((x) => x.type === 'outro'))
    setReel((r) => ({ ...r, scenes: [...r.scenes.slice(0, at), s, ...r.scenes.slice(at)] }))
    setSel(s.id)
  }
  const addCard = () => insert({ id: uid(), type: 'card', text: '', duration: 2000 })
  const addDemo = () => {
    const rec = list.recordings.find((r) => r.file.startsWith(dir + '/')) || list.recordings[0]
    if (!rec) return onToast('Record a take first')
    insert({ id: uid(), type: 'demo', take: relative(dir, rec.file), from: 0, to: rec.duration })
  }
  const remove = () => { setReel((r) => ({ ...r, scenes: r.scenes.filter((s) => s.id !== sel) })); setSel(null) }

  // Reorder by dragging rows in the scene list
  const dragFrom = useRef(null)
  const drop = (to) => {
    const from = dragFrom.current
    dragFrom.current = null
    if (from === null || from === to) return
    setReel((r) => {
      const next = [...r.scenes]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...r, scenes: next }
    })
  }

  // Timeline: drag a scene's right edge to change how long it is (a demo's end in the take)
  const laneRef = useRef(null)
  const pxPerMs = (laneRef.current?.clientWidth || 1) / Math.max(1, length)
  const resize = (e, item) => {
    e.stopPropagation(); e.preventDefault()
    setSel(item.scene.id)
    const x0 = e.clientX
    const orig = { ...item.scene }
    const take = list.recordings.find((r) => r.file === resolve(dir, orig.take || ''))
    const move = (ev) => {
      const dt = (ev.clientX - x0) / pxPerMs
      setReel((r) => ({
        ...r,
        scenes: r.scenes.map((s) => {
          if (s.id !== orig.id) return s
          if (s.type === 'demo') return { ...s, to: Math.round(clamp((orig.to ?? take?.duration ?? 0) + dt, (orig.from ?? 0) + 500, take?.duration ?? Infinity)) }
          return { ...s, duration: Math.round(clamp((orig.duration ?? R.DEFAULTS[s.type]) + dt, 600, 15000) / 100) * 100 }
        }),
      }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const seekLane = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    seek(((e.clientX - r.left) / r.width) * length)
  }

  // Keyboard: Space plays, Delete removes the selected scene
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return
      if (e.key === ' ') { e.preventDefault(); play() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) remove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Export: HTML or MP4, rendered in the background
  const render = async (kind) => {
    try {
      const { job: j } = await api.renderReel(id, kind)
      setJob({ id: j, kind, status: 'running', progress: 0 })
    } catch (e) { onToast(e.message) }
  }
  useEffect(() => {
    if (job?.status !== 'running') return
    const tm = setInterval(async () => {
      const j = await api.job(job.id).catch(() => null)
      if (!j) return
      setJob({ ...job, ...j })
      if (j.status === 'done') onToast(`Saved ${j.out.split('/').pop()}`, ['Show in Finder', () => api.reveal(j.out)])
      if (j.status === 'failed') onToast(`Export failed: ${j.log.trim().split('\n').pop()}`)
    }, 600)
    return () => clearInterval(tm)
  }, [job, onToast])

  const newReel = async () => {
    const folder = list.recordings[0]?.folder || ''
    const { id: nid } = await api.newReel(folder)
    await refresh()
    setId(nid)
  }

  const current_ = reels.find((r) => r.id === id)
  const rendering = job?.status === 'running'

  return (
    <div className="studio">
      <header className="topbar">
        <div className="crumbs">
          {modeSwitch}
          {reels.length > 1 ? (
            <select className="reel-pick" value={id || ''} onChange={(e) => setId(e.target.value)}>
              {reels.map((r) => <option key={r.id} value={r.id}>{r.folder}/{r.name}</option>)}
            </select>
          ) : <b>{current_?.name || 'Reels'}</b>}
          {save && <span className="state">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : save}</span>}
        </div>
        <div className="actions">
          <button className="btn" onClick={newReel}>New reel</button>
          <button className="btn" disabled={!ready || rendering} onClick={() => render('html')}>{rendering && job.kind === 'html' ? 'Exporting…' : 'HTML'}</button>
          <button className="btn primary" disabled={!ready || rendering} onClick={() => render('mp4')}>
            {rendering && job.kind === 'mp4' ? `Rendering ${Math.round((job.progress || 0) * 100)}%` : 'Export MP4'}
          </button>
        </div>
      </header>

      {!reels.length ? (
        <div className="reel-empty">
          <h2>No reels yet</h2>
          <p className="dim">A reel is a feature told as text, then demonstration: a card that says what you can do, then a take that shows it.</p>
          <button className="btn primary" onClick={newReel} disabled={!list.recordings.length}>New reel from these takes</button>
        </div>
      ) : (
        <>
          <div className="body">
            <nav className="library" aria-label="Scenes">
              <div className="library-head"><b>Scenes</b><span className="mono">{time(length).replace(/\.\d$/, '')}</span></div>
              {scenes.map((s, i) => {
                const item = items[i]
                const on = s.id === sel
                return (
                  <button
                    key={s.id} className={`rec-row scene-row${on ? ' on' : ''}${current?.scene.id === s.id ? ' live' : ''}`} draggable
                    onDragStart={() => { dragFrom.current = i }} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(i)}
                    onClick={() => select(s.id)}
                  >
                    <span className="scene-n mono">{i + 1}</span>
                    <Mini scene={s} />
                    <span className="tx">
                      <b>{s.type === 'demo' ? s.take.replace(/\.json$/, '').split('/').pop() : s.type === 'opener' ? s.title || 'Opener' : s.text || (s.type === 'outro' ? 'Outro' : 'Card')}</b>
                      <span className="mono">{LABEL[s.type]} · {s.type === 'demo' ? `${time(s.from ?? 0).replace(/\.\d$/, '')}–${time(s.to ?? 0).replace(/\.\d$/, '')}` : `${((item?.duration ?? 0) / 1000).toFixed(1)} s`}</span>
                    </span>
                  </button>
                )
              })}
              <div className="scene-add">
                <button className="btn sm" onClick={addCard}>Add card</button>
                <button className="btn sm" onClick={addDemo}>Add demo</button>
              </div>
            </nav>

            <main className="stage-col">
              <div className="stage-box" ref={previewBox}>
                {ready ? <div className="reel-preview" style={{ width: pw }}><div ref={root} style={{ position: 'relative', width: '100%' }} /></div> : <span className="dim">Loading…</span>}
              </div>
              <div className="transport" style={{ width: pw || '100%' }}>
                <div className="left">
                  <button className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={play}>
                    {playing
                      ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>}
                  </button>
                  <span className="time">{time(t)}</span>
                  <span className="time faint">/ {time(length)}</span>
                </div>
              </div>
            </main>

            <aside className="inspector">
              {scene && (
                <section className="section">
                  <div className="section-head"><h2>{LABEL[scene.type]}</h2><span className="mono dim">scene {scenes.indexOf(scene) + 1} · {((items.find((i) => i.scene.id === sel)?.duration ?? 0) / 1000).toFixed(1)} s</span></div>
                  {scene.type === 'opener' && (
                    <>
                      <label className="field"><span>Product</span><input className="text-line" value={scene.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="New in DAISY" /></label>
                      <label className="field"><span>Feature</span><input className="text-line" value={scene.sub || ''} onChange={(e) => patch({ sub: e.target.value })} placeholder="One app, every client" /></label>
                    </>
                  )}
                  {scene.type === 'card' && (
                    <label className="field">
                      <span>Says</span>
                      <textarea className="text-in" autoFocus value={scene.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="Switch client from the sidebar" />
                      <span className="dim">What you can do, in under seven words. No full stop.</span>
                    </label>
                  )}
                  {scene.type === 'outro' && (
                    <label className="field"><span>Line under the logo</span><input className="text-line" value={scene.text || ''} onChange={(e) => patch({ text: e.target.value })} placeholder="yourproduct.com" /></label>
                  )}
                  {scene.type !== 'demo' && (
                    <Slider label="Length" value={scene.duration ?? R.DEFAULTS[scene.type]} display={`${((scene.duration ?? R.DEFAULTS[scene.type]) / 1000).toFixed(1)} s`} min={800} max={6000} step={100} onChange={(v) => patch({ duration: v })} />
                  )}
                  {scene.type === 'demo' && (
                    <>
                      <div className="field-row">
                        <span>Take</span>
                        <select className="reel-pick" value={scene.take} onChange={(e) => { const rec = list.recordings.find((r) => relative(dir, r.file) === e.target.value); patch({ take: e.target.value, from: 0, to: rec?.duration }) }}>
                          {list.recordings.map((r) => <option key={r.id} value={relative(dir, r.file)}>{r.name}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <div className="field-row">
                          <span>Part of the take</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input className="num-in" aria-label="From (seconds)" value={((scene.from ?? 0) / 1000).toFixed(1)} onChange={(e) => patch({ from: Math.round(Number(e.target.value) * 1000) || 0 })} />
                            <span className="dim">–</span>
                            <input className="num-in" aria-label="To (seconds)" value={((scene.to ?? 0) / 1000).toFixed(1)} onChange={(e) => patch({ to: Math.round(Number(e.target.value) * 1000) || 0 })} />
                          </span>
                        </div>
                        <span className="dim">Plays through the take's edit: its zooms, cuts and speed.</span>
                        <button className="btn sm accent" style={{ alignSelf: 'flex-start' }} disabled={!idForTake(scene.take)} onClick={() => onEditTake(idForTake(scene.take))}>Edit the take</button>
                      </div>
                      <Slider label="Window size" value={Math.round((scene.window ?? (shape.width > shape.height ? 0.74 : 0.86)) * 100)} display={`${Math.round((scene.window ?? (shape.width > shape.height ? 0.74 : 0.86)) * 100)}%`} min={50} max={96} step={1} onChange={(v) => patch({ window: v / 100 })} />
                    </>
                  )}
                  <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={remove}>Remove scene</button>
                </section>
              )}
              {reel && (
                <section className="section">
                  <div className="section-head"><h3>Reel</h3></div>
                  <div className="field">
                    <span>Background</span>
                    <div className="swatches">
                      {Object.entries(R.BACKGROUNDS).map(([k, bg]) => (
                        <button key={k} className={`swatch${(reel.background || 'dusk') === k ? ' on' : ''}`} style={{ background: bg }} aria-label={k} title={k} onClick={() => setOpt({ background: k })} />
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <div className="field-row">
                      <span>Shape</span>
                      <Seg options={Object.keys(R.SHAPES).map((k) => [k, k])} value={reel.shape || '16:9'} onChange={(v) => setOpt({ shape: v })} />
                    </div>
                    <span className="dim">For {shape.use}.</span>
                  </div>
                  <div className="field-row">
                    <span>Cards</span>
                    <Seg options={[['light', 'Light'], ['dark', 'Dark']]} value={reel.cards || 'light'} onChange={(v) => setOpt({ cards: v })} />
                  </div>
                  <label className="field">
                    <span>Logo</span>
                    <input className="text-line" value={reel.brand?.mark || ''} onChange={(e) => setOpt({ brand: { ...reel.brand, mark: e.target.value || null } })} placeholder="Image URL, or a path beside the reel" />
                  </label>
                </section>
              )}
            </aside>
          </div>

          <div className="timeline reel-timeline">
            <div className="reel-ruler" onPointerDown={seekLane}>
              {Array.from({ length: Math.floor(length / 5000) + 1 }, (_, i) => <span key={i} className="tick" style={{ left: `${((i * 5000) / Math.max(1, length)) * 100}%` }}>{i * 5}s</span>)}
            </div>
            <div className="reel-lane" ref={laneRef} onPointerDown={seekLane}>
              {items.map((item) => {
                const s = item.scene
                return (
                  <div key={s.id} className={`reel-block ${s.type}${s.id === sel ? ' sel' : ''}`} style={{ left: `${(item.start / Math.max(1, length)) * 100}%`, width: `calc(${(item.duration / Math.max(1, length)) * 100}% - 4px)`, background: s.type === 'demo' ? R.BACKGROUNDS[reel.background || 'dusk'] : undefined }}
                    onPointerDown={(e) => { e.stopPropagation(); select(s.id) }}>
                    <span>{s.type === 'demo' ? s.take.replace(/\.json$/, '').split('/').pop() : s.type === 'opener' ? s.title : s.text}</span>
                    <i className="edge" onPointerDown={(e) => resize(e, item)} />
                  </div>
                )
              })}
              <div className="playhead" style={{ left: `${(t / Math.max(1, length)) * 100}%`, top: -24, bottom: -6 }}><i /><b /></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
