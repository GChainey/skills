---
name: html-recording
description: "Record a web page or prototype as an HTML recording instead of a screen video. rrweb captures the real DOM, its CSS and every change; a small player replays it in the page, sharp at any zoom with exact colours, at around 1% of a video's size. Use whenever someone wants a demo, clip, walkthrough, screen recording, replay, 'record this flow', a recording for a case study, docs, a README, Slack or Notion, or to re-record an existing clip after the UI changed. Not for canvas or WebGL content (games, maps, shaders): that still needs video."
---

# HTML recordings

A recording here is not pixels. A script drives the page in headless Chromium while
[rrweb](https://github.com/rrweb-io/rrweb) records the DOM, its CSS and every change as JSON.
A player rebuilds that in a sandboxed iframe, so the clip is the real UI: sharp at any zoom,
exact colours, a cursor on top, and typically 20 to 150 times smaller than an MP4 of the same
take. Background and side-by-side comparisons: https://garethchainey.com/replay-vs-video

`SKILL_DIR` below means the folder this file is in. Everything the skill needs is inside it.

| File | What it does |
| --- | --- |
| `tools/rrlib.mjs` | `record(name, run, opts)`: the recorder and the API for driving the page |
| `tools/snap.mjs` | Screenshots a recording at given seconds, to check it |
| `tools/export.mjs` | Packages recordings for a website (`--to`) or as one self-contained HTML file (`--single`) |
| `tools/player/html-recording.js` | `<html-recording>`: the player, a web component with no build step |
| `tools/localise.mjs` | Saves the images, fonts and CSS a recording uses and re-points them (runs automatically) |
| `tools/fix-values.mjs` | Makes typed fields replay their later values (runs automatically) |
| `examples/clip.mjs` | A clip script to copy |
| `examples/public-site.mjs` | Recording a public site: dark mode, scrolled and cropped to one part of the page |

## 1. Set up (once)

```bash
"$SKILL_DIR/tools/setup.sh"
```

Installs `@rrweb/record`, `@rrweb/replay` and Playwright into `tools/node_modules`, and the
Chromium it drives. Needs Node 20 or later.

## 2. Serve what you're recording

A local dev server (`npm run dev`, `python3 -m http.server`, …) or any public URL. If the port
could belong to something else, check it's the right app before recording
(`lsof -iTCP:<port> -sTCP:LISTEN`).

## 3. Write a clip script

Put it next to the work, somewhere gitignored if it shouldn't ship (e.g. `.context/clips.mjs`).
Copy `examples/clip.mjs` and change the steps; import `rrlib.mjs` by its absolute path. One file
can hold several clips, picked by argv.

```js
import { record } from '<SKILL_DIR>/tools/rrlib.mjs'

await record('invite', async (r) => {
  const { page } = r                    // the Playwright page, for locators
  await r.goto('/settings')             // BASE_URL + path, or a full URL
  // Set the scene here: nothing before start() is recorded
  await r.start()
  await r.wait(600)                     // a beat on the first frame
  await r.click(page.getByRole('tab', { name: 'Team' }), { after: 900 })
  await r.type(page.getByRole('textbox', { name: 'Email' }), 'sam@example.com')
  await r.fast(4, () => page.getByText('Invite sent').waitFor())  // a slow wait, 4× faster
  await r.cut(() => page.waitForLoadState('networkidle'))         // a load, cut out entirely
  await r.focus(page.getByRole('dialog'), { pad: 24 })            // crop the player to this
  await r.wait(1500)                    // hold the end so it can be read before it loops
}, { viewport: { width: 1280, height: 800 } })
```

On `r`: `goto(url)`, `start()`, `wait(ms)`, `click(target, { after, duration })`,
`moveTo(target)`, `type(target, text, { delay })`, `scroll(deltaY)`, `css(text)`,
`fast(factor, fn)`, `cut(fn)`, `focus(target, { pad })`, `page`, `errors`. A target is a
Playwright locator or `{ x, y }`.

`record` options: `viewport` (1280×800 by default), `colorScheme` (`'light'`/`'dark'`), `speed`
(the whole clip), `setup(context)` (block requests such as analytics, set cookies, add init
scripts to fake data), `origins` (public origins whose assets to save, e.g.
`['https://example.com']`), `locale`, `timezoneId`, `domCursor` (draw the cursor as a page
element instead of recording the mouse), `out`, `assetPath`.

Making a clip look good:
- Move like a person. `click` already glides (650 ms, eased) and holds 450 ms; give results time
  to land with `after: 900` to `3000`. End on a 1 to 2 s hold.
- One idea per clip, 5 to 20 s. 16:10 viewport.
- Hide dev overlays, cookie banners and debug chrome with `r.css(...)` before `start()`. The
  agentation toolbar is hidden automatically.
- Live AI responses are fine: wrap the wait in `fast()`.
- Canvas content doesn't record. If a small part of the page is a canvas (a QR code, a chart),
  swap it for an `<img>` of itself in the clip script before `start()`.
- Inputs are not masked and hidden values in the DOM are recorded. Don't record real credentials
  or customer data.

## 4. Record

```bash
BASE_URL=http://localhost:3000 RR_OUT=recordings RR_ASSET_PATH=/recordings/assets \
  node clips.mjs [clip-name]
```

It prints `{ name, out, seconds, events, kb, errors }`. `errors` are page exceptions during the
take: re-record if any matter. Output: `<RR_OUT>/<name>.json` and `<RR_OUT>/assets/`.

`RR_ASSET_PATH` is the URL the website will serve the assets folder from (default
`/replays/assets`). `export.mjs` can rewrite it later, so it only matters if you copy the files
by hand.

## 5. Check it

```bash
node "$SKILL_DIR/tools/snap.mjs" recordings/<name>.json 1,4,8 --out recordings/snaps
```

Look at the screenshots: the page rendered (fonts, images, not a blank frame), the step you meant
is on screen at each time, and nothing private is showing. Show them to the user.

## 6. Put it where it's going

**A website or prototype, no build step:**

```bash
node "$SKILL_DIR/tools/export.mjs" recordings/<name>.json --to public/recordings --root public
```

copies the player, the recording and only the assets it uses, re-pointed at the folder's URL
(pass `--url /path` if the site isn't served from `--root`). Then on any page:

```html
<script src="/recordings/html-recording.js"></script>
<html-recording src="/recordings/<name>.json" bar></html-recording>
```

Attributes: `src` (a URL, or `#id` of an inline `<script type="application/json">`),
`region="x,y,width,height"` to crop (defaults to the `focus()` crop; `none` shows the whole
screen), `bar` (a window bar), `aspect` (CSS aspect-ratio), `controls` (play/pause and a
scrubber). It loads near the viewport, loops after a beat, pauses off screen, and shows the last
frame to people who prefer reduced motion.

**React or Next.js:** the same export works (load the script once with `next/script`, then use the
element). For a native component, see `RecordingReplay.tsx` in
https://github.com/GChainey/portfolioWebsite/tree/main/src/components/replay: it loads
`@rrweb/replay` and adds timed subtitles.

**One file to share** (Slack, Notion, email, a PR; opens from disk):

```bash
node "$SKILL_DIR/tools/export.mjs" recordings/<name>.json --single <name>.html --bar --controls --title "…"
```

Assets become data URIs. Several recordings can go in one file.

## Limits

- `<canvas>` and WebGL aren't recorded. Use video for games, maps and shaders.
- Cross-origin iframes come out blank. Same-origin ones are fine.
- Assets from origins not in `origins` stay as live URLs, so the clip changes if they do. Fix up
  afterwards with `node "$SKILL_DIR/tools/localise.mjs" --origin https://… recordings/*.json`.
- It's a recording of the UI as it was: re-record after the UI changes.
- It plays in a browser only. For social media you still need a video.

MIT licensed (`LICENSE`). The bundled `rrweb-replay.min.js` is rrweb's, also MIT (`tools/player/NOTICE`).
