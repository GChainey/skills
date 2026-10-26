import { useEffect, useRef, useState } from 'react'
import { Replayer } from '@rrweb/replay'
import { loadRecording } from './api.js'

// A tiny replay frozen on one moment: the recording itself, not a screenshot. Builds only when
// it scrolls into view.
export function Thumb({ id, rec, at = 0.4, width, height }) {
  const box = useRef(null)
  const mount = useRef(null)
  const [visible, setVisible] = useState(false)
  const [data, setData] = useState(rec || null)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '100px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [])
  useEffect(() => { if (rec) setData(rec) }, [rec])
  useEffect(() => {
    if (visible && !data && id) loadRecording(id).then(setData).catch(() => {})
  }, [visible, data, id])

  useEffect(() => {
    if (!visible || !data) return
    const { meta, events } = data
    const r = new Replayer(events, { root: mount.current, mouseTail: false, showWarning: false, triggerFocus: false, UNSAFE_replayCanvas: false, speed: 1 })
    r.pause(Math.round(meta.duration * at))
    const k = Math.max(width / meta.width, height / meta.height)
    Object.assign(mount.current.style, { width: meta.width + 'px', height: meta.height + 'px', transform: `scale(${k})` })
    return () => { r.destroy(); mount.current && (mount.current.innerHTML = '') }
  }, [visible, data, at, width, height])

  return (
    <span ref={box} className="thumb" style={{ width, height }}>
      <span ref={mount} className="mount" />
    </span>
  )
}
