// rrweb records a field's later value changes as attribute mutations once it has had an input
// event, and the replayer ignores those, so the field looks stuck (a rewrite that never lands, a
// chat box that never clears). Replay them as input events instead. record() runs this itself;
// the CLI is for recordings made before it did:  node fix-values.mjs out/*.json
import fs from 'node:fs'

export function fixValues(events) {
  const typed = new Set(), out = []
  for (const e of events) {
    out.push(e)
    if (e.type !== 3) continue
    if (e.data.source === 5) typed.add(e.data.id)
    if (e.data.source === 0) for (const a of e.data.attributes || []) {
      if (typed.has(a.id) && typeof a.attributes.value === 'string') {
        out.push({ type: 3, data: { source: 5, text: a.attributes.value, isChecked: false, id: a.id }, timestamp: e.timestamp })
      }
    }
  }
  return out
}

if (process.argv[1] === import.meta.filename) {
  for (const p of process.argv.slice(2)) {
    const r = JSON.parse(fs.readFileSync(p, 'utf8'))
    const before = r.events.length
    r.events = fixValues(r.events)
    fs.writeFileSync(p, JSON.stringify(r))
    console.log(p, 'added', r.events.length - before)
  }
}
