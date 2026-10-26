import { E, clamp, regionText, time } from './util.js'

function Slider({ label, value, display, min, max, step, onBegin, onChange }) {
  const p = `${((value - min) / (max - min)) * 100}%`
  return (
    <div className="field">
      <div className="field-row">
        <span>{label}</span>
        <span className="mono">{display}</span>
      </div>
      <input
        className="slider" type="range" min={min} max={max} step={step} value={value} style={{ '--p': p }}
        onPointerDown={onBegin} onKeyDown={onBegin}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

const Toggle = ({ on, onClick, label }) => <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick} />

function Seg({ options, value, onChange, small }) {
  return (
    <div className={`seg${small ? ' sm' : ''}`}>
      {options.map(([v, l]) => <button key={l} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

// Scale a region about its centre to a zoom level of the view, keeping the view's shape
function zoomRegion(region, level, view, screen) {
  const width = view.width / level
  const height = width / (view.width / view.height)
  const cx = region.x + region.width / 2, cy = region.y + region.height / 2
  return {
    x: Math.round(clamp(cx - width / 2, 0, screen.width - width)),
    y: Math.round(clamp(cy - height / 2, 0, screen.height - height)),
    width: Math.round(width), height: Math.round(height),
  }
}

export function Inspector({ rec, edit, selection, view, length, knobs, setKnobs, canRecord, job, onBegin, onChange, onSelect, onPick, onRemove }) {
  const screen = { width: rec.meta.width, height: rec.meta.height }
  const listKey = { zoom: 'zooms', cut: 'cuts', speed: 'speeds', caption: 'captions' }[selection?.kind]
  const item = listKey ? edit[listKey].find((b) => b.id === selection.id) : null
  const update = (patch) => onChange((ed) => ({ ...ed, [listKey]: ed[listKey].map((b) => (b.id === item.id ? { ...b, ...patch } : b)) }))
  const commit = (patch) => { onBegin(); update(patch) }

  return (
    <aside className="inspector">
      {item && selection.kind === 'zoom' && (
        <section className="section">
          <div className="section-head"><h2>Zoom {edit.zooms.indexOf(item) + 1}</h2><span className="mono dim">at {time(item.start)}</span></div>
          <div className="field">
            <div className="field-row">
              <span>Area</span>
              <button className="btn sm accent" onClick={() => onPick('zoom', item.id)}>Pick on screen</button>
            </div>
            <span className="mono dim">{regionText(item.region)}</span>
          </div>
          <Slider label="Zoom" value={+(view.width / item.region.width).toFixed(2)} display={`${(view.width / item.region.width).toFixed(1)}×`} min={1} max={5} step={0.1} onBegin={onBegin}
            onChange={(v) => update({ region: zoomRegion(item.region, v, view, screen) })} />
          <Slider label="Move" value={item.move ?? 900} display={`${((item.move ?? 900) / 1000).toFixed(1)} s`} min={200} max={2000} step={50} onBegin={onBegin}
            onChange={(v) => update({ move: v })} />
          <div className="field">
            <div className="field-row">
              <span>Highlight</span>
              <Toggle label="Highlight" on={!!item.highlight} onClick={() => (item.highlight ? commit({ highlight: null }) : onPick('highlight', item.id))} />
            </div>
            {item.highlight && (
              <div className="field-row">
                <span className="dim" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.highlight.label ? `“${item.highlight.label}”` : regionText(item.highlight)}</span>
                <button className="btn sm" onClick={() => onPick('highlight', item.id)}>Pick again</button>
              </div>
            )}
          </div>
          <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove zoom</button>
        </section>
      )}

      {item && selection.kind === 'cut' && (
        <section className="section">
          <div className="section-head"><h2>Cut</h2><span className="mono dim">{time(item.start)} – {time(item.end)}</span></div>
          <span className="dim">{((item.end - item.start) / 1000).toFixed(1)} s left out of the clip.</span>
          <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove cut</button>
        </section>
      )}

      {item && selection.kind === 'speed' && (
        <section className="section">
          <div className="section-head"><h2>Speed</h2><span className="mono dim">{time(item.start)} – {time(item.end)}</span></div>
          <Slider label="Rate" value={item.rate} display={`${item.rate}×`} min={0.5} max={8} step={0.25} onBegin={onBegin} onChange={(v) => update({ rate: v })} />
          <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove speed change</button>
        </section>
      )}

      {item && selection.kind === 'caption' && (
        <section className="section">
          <div className="section-head"><h2>Caption</h2><span className="mono dim">{time(item.start)} – {time(item.end)}</span></div>
          <textarea className="text-in" autoFocus value={item.text} placeholder="What to read here" onFocus={onBegin} onChange={(e) => update({ text: e.target.value })} />
          <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove caption</button>
        </section>
      )}

      {!item && (
        <section className="section">
          <div className="section-head"><h2>Clip</h2><span className="mono dim">{time(length)}</span></div>
          <div className="field">
            <div className="field-row">
              <span>Crop</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {edit.crop && <button className="btn sm" onClick={() => { onBegin(); onChange((ed) => ({ ...ed, crop: null })) }}>Clear</button>}
                <button className="btn sm accent" onClick={() => onPick('crop')}>Pick on screen</button>
              </div>
            </div>
            <span className="mono dim">{regionText(edit.crop)}</span>
          </div>
          <div className="field-row">
            <span>Trim</span>
            <span className="mono dim">{time(edit.trim.start)} – {time(edit.trim.end)}</span>
          </div>
          <div className="keys">
            <kbd>Space</kbd><span>Play or pause</span>
            <kbd>Z</kbd><span>Zoom at the playhead</span>
            <kbd>C</kbd><span>Cut a second from the playhead</span>
            <kbd>S</kbd><span>Speed up from the playhead</span>
            <kbd>T</kbd><span>Caption at the playhead</span>
            <kbd>I · O</kbd><span>Trim the start or end to the playhead</span>
            <kbd>⌘Z</kbd><span>Undo</span>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h3>Next take</h3></div>
        {!canRecord && <span className="dim">Re-record needs a take made with the current recorder, so it knows which script to run.</span>}
        <Slider label="Cursor speed" value={knobs.glide} display={`${knobs.glide} ms`} min={150} max={900} step={10} onChange={(v) => setKnobs({ ...knobs, glide: v })} />
        <Slider label="Pauses" value={knobs.pause} display={`${knobs.pause.toFixed(1)}×`} min={0.4} max={2} step={0.1} onChange={(v) => setKnobs({ ...knobs, pause: v })} />
        <div className="field-row">
          <span>Screen</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="num-in" aria-label="Screen width" value={knobs.width} onChange={(e) => setKnobs({ ...knobs, width: Number(e.target.value) || knobs.width })} />
            <span className="dim">×</span>
            <input className="num-in" aria-label="Screen height" value={knobs.height} onChange={(e) => setKnobs({ ...knobs, height: Number(e.target.value) || knobs.height })} />
          </span>
        </div>
        <div className="field-row">
          <span>Theme</span>
          <Seg small options={[['light', 'Light'], ['dark', 'Dark']]} value={knobs.scheme} onChange={(v) => setKnobs({ ...knobs, scheme: v })} />
        </div>
        {job && job.status !== 'done' && (
          <div className="field">
            <span className={job.status === 'failed' ? '' : 'dim'} style={job.status === 'failed' ? { color: '#ff8b8f' } : undefined}>
              {job.status === 'failed' ? 'The take failed. The last lines it printed:' : 'Recording a new take…'}
            </span>
            {job.status === 'failed' && <pre className="log">{job.log.trim().split('\n').slice(-12).join('\n')}</pre>}
          </div>
        )}
      </section>
    </aside>
  )
}

export { zoomRegion }
// The zoom for something picked on screen: around it with some room, in the view's shape, and
// no closer than 2.5× so the viewer keeps their bearings
export function zoomFor(pickRegion, view, screen) {
  const aspect = view.width / view.height
  const minWidth = view.width / 2.5
  const pad = { x: pickRegion.x - 24, y: pickRegion.y - 24, width: pickRegion.width + 48, height: pickRegion.height + 48 }
  const fitted = E.toAspect(pad, aspect)
  if (fitted.width >= minWidth) return E.toAspect(fitted, aspect, screen)
  const cx = fitted.x + fitted.width / 2, cy = fitted.y + fitted.height / 2
  return E.toAspect({ x: cx - minWidth / 2, y: cy - minWidth / aspect / 2, width: minWidth, height: minWidth / aspect }, aspect, screen)
}
