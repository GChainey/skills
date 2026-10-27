#!/usr/bin/env node
// html-recording: the recorder's tools from any project.
//
//   npx html-recording setup                         install the Chromium the recorder drives
//   npx html-recording record <clips.mjs> [clip]     run a clip script (--base <url> --out <folder>)
//   npx html-recording studio [folder…]              open Recording Studio (--port 4747 --no-open)
//   npx html-recording export <rec.json…> …          --to <folder> | --single <file.html>
//   npx html-recording snap <rec.json> <secs>        screenshots to check a take (--out <folder>)
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const HERE = import.meta.dirname
const [cmd, ...args] = process.argv.slice(2)
const run = (script, argv, env = {}) => {
  const child = spawn(process.execPath, [script, ...argv], { stdio: 'inherit', env: { ...process.env, ...env } })
  child.on('exit', (code) => process.exit(code ?? 1))
}

// Pull --flag value pairs out of the arguments
function take(flag) {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  const [, value] = args.splice(i, 2)
  return value
}

switch (cmd) {
  case 'setup': {
    const pw = path.dirname(createRequire(import.meta.url).resolve('playwright/package.json'))
    run(path.join(pw, 'cli.js'), ['install', 'chromium'])
    break
  }
  case 'record': {
    const base = take('--base'), out = take('--out'), assets = take('--asset-path')
    const [script, ...rest] = args
    if (!script) { console.error('usage: html-recording record <clips.mjs> [clip] [--base http://localhost:3000] [--out recordings]'); process.exit(1) }
    run(path.resolve(script), rest, { ...(base && { BASE_URL: base }), ...(out && { RR_OUT: path.resolve(out) }), ...(assets && { RR_ASSET_PATH: assets }) })
    break
  }
  case 'studio': run(path.join(HERE, 'studio/server.mjs'), args); break
  case 'export': run(path.join(HERE, 'tools/export.mjs'), args); break
  case 'snap': run(path.join(HERE, 'tools/snap.mjs'), args); break
  default:
    console.log(`html-recording: record web pages as HTML, edit them, play them anywhere

  npx html-recording setup                       install the Chromium the recorder drives (once)
  npx html-recording record <clips.mjs> [clip]   run a clip script  --base <url>  --out <folder>
  npx html-recording studio [folder…]            open Recording Studio  --port 4747  --no-open
  npx html-recording export <rec.json…>          --to <folder> [--url /path]  |  --single <file.html>
  npx html-recording snap <rec.json> <1,4,8>     screenshots to check a take  --out <folder>

In a clip script:  import { record } from 'html-recording'
Guide: https://github.com/GChainey/skills/tree/main/skills/html-recording`)
    process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0)
}
