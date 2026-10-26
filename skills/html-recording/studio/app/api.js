const json = async (res) => {
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || res.statusText)
  return data
}
const send = (method, url, body) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json)

export const api = {
  recordings: () => fetch('/api/recordings').then(json),
  recording: (id) => fetch(`/api/recording?id=${id}`).then(json),
  edit: (id) => fetch(`/api/edit?id=${id}`).then(json),
  saveEdit: (id, edit) => send('PUT', `/api/edit?id=${id}`, edit),
  rerecord: (id, knobs) => send('POST', '/api/rerecord', { id, knobs }),
  job: (job) => fetch(`/api/jobs/${job}`).then(json),
  exportSingle: (id) => send('POST', '/api/export', { id }),
  reveal: (path) => send('POST', '/api/reveal', { path }),
}

// Recordings are big; fetch each once
const cache = new Map()
export const loadRecording = (id) => {
  if (!cache.has(id)) cache.set(id, api.recording(id).catch((e) => { cache.delete(id); throw e }))
  return cache.get(id)
}
export const forgetRecording = (id) => cache.delete(id)
