# html-recording

Record a web page as HTML instead of video. A script drives the page in headless Chromium while
[rrweb](https://github.com/rrweb-io/rrweb) records the DOM, its CSS and every change. The player
rebuilds that in the page, so a clip is the real UI: sharp at any zoom, exact colours, and around
1% of the size of an MP4. Then edit it in **Recording Studio**: zooms that follow the mouse, cuts,
speed changes, highlights and captions. [Why HTML, not video](https://garethchainey.com/replay-vs-video)

```bash
npm i -D html-recording
npx html-recording setup        # once: the Chromium it drives
```

## Record

```js
// clips.mjs
import { record } from 'html-recording'

await record('invite', async (r) => {
  const { page } = r
  await r.goto('/settings')
  await r.start()                                   // nothing before this is recorded
  await r.click(page.getByRole('tab', { name: 'Team' }), { after: 900 })
  await r.type(page.getByRole('textbox', { name: 'Email' }), 'sam@example.com')
  await r.wait(1500)
}, { viewport: { width: 1440, height: 900 } })
```

```bash
npx html-recording record clips.mjs --base http://localhost:3000 --out recordings
```

## Edit

```bash
npx html-recording studio recordings     # http://localhost:4747
```

- Zooms work like Screen Studio's: the whole screen is in frame until a zoom, then the camera eases
  in and follows the mouse. **Zoom on clicks** adds one over each run of clicks.
- The replay is the real page, so a fixed zoom area, highlight or crop is picked by clicking the
  element.
- Cuts, speed changes and captions sit on a timeline. `Z` `C` `S` `T` add them at the playhead.
- **Re-record** runs the clip again with a different cursor speed, pause length, screen size or theme.

Edits save as `<name>.edit.json` beside the recording, which is never changed.

## Sizzle reels

The studio's **Reels** view cuts takes into a reel the way Cursor shows a feature: a card that says
what you can do, then a demo of it, repeated, with an opener and the logo. Export it as an MP4 for
X, LinkedIn or YouTube (`npx html-recording reel name.reel.json --mp4 name.mp4`, needs ffmpeg) or one
HTML file (`--single name.html`). Guide: the [sizzle-reel skill](https://github.com/GChainey/skills/tree/main/skills/sizzle-reel).

## Play

```bash
npx html-recording export recordings/invite.json --to public/recordings --root public
```

```html
<script src="/recordings/html-recording.js"></script>
<html-recording src="/recordings/invite.json" bar></html-recording>
```

Or one self-contained file to share: `npx html-recording export recordings/invite.json --single invite.html --bar --controls`.

The full guide, including how an AI agent should use it, is in [SKILL.md](./SKILL.md). It is also an
[agent skill](https://github.com/GChainey/skills): `npx skills add GChainey/skills --skill html-recording -g`.

MIT
