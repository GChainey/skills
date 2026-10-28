---
name: sizzle-reel
description: "Make a sizzle reel of a feature: text in, demonstration next. An opener, then a short chapter card ('Leave comments for your agents') followed by a recorded demo of exactly that, repeated four to six times, then the logo, the way Cursor shows a new feature. Built on html-recording: each demo is a real HTML recording with zooms that follow the mouse, laid out and tuned in Recording Studio's Reels view, exported as an MP4 for X, LinkedIn or YouTube, or as one HTML file for the web. Use when someone wants a sizzle reel, launch video, feature video, product teaser, 'show this feature like Cursor does', a reel for a case study, or a social post of a feature."
---

# Sizzle reels

A reel says what you can do, then shows it. Cursor's "New in Cursor: Annotate" (43 s) is the model:

| Scene | What it is | Length |
| --- | --- | --- |
| Opener | Logo, then the product in black and the feature in grey under it | ~3 s |
| Card | One sentence on white: what you can do. "Open your app in the browser" | ~2 s |
| Demo | The app in a window on a soft gradient, doing exactly what the card said. The camera pushes in on the action and follows the mouse | 4–8 s |
| … | Card, demo, card, demo: four to six of them | |
| Outro | The logo on black, optionally a link | ~2.5 s |

Hard cuts between scenes; all the motion is inside the demos. Under 45 seconds.

It uses the **html-recording** skill and package for everything underneath (recording, editing,
the player). Use the npm package in a project (`npm i -D html-recording`, `npx html-recording …`),
or the skill's own copy for a one-off. Read that skill first if you haven't.

## 1. Write the beats first

Before recording anything, write the reel as text and show it to the user:

```
Opener:  New in DAISY / One app, every client
1. Pick a client from the sidebar
2. Every client keeps its own data
3. Open a state significant case
Outro:   enterpriseaigroup.com
```

The cards carry the whole story, so the copy matters most:

- **An instruction or a plain fact about what you can do**, never a slogan: "Leave comments for
  your agents", "Dial in your styles, live", "Check responsiveness".
- **Under seven words.** Sentence case. No full stop, no exclamation mark, no emoji.
- **Each card is one thing the next demo shows.** If the demo would need two cards, it's two beats.
- **Four to six beats.** Fewer is fine; more makes it a tutorial.
- The opener names the product and the feature; nothing else.

## 2. Record one take per beat

With html-recording: one clip per beat, each starting from where the user would be. Keep each to
what its card says, 3–8 seconds of real action, with a beat of stillness at each end so the cut
lands cleanly. Faster cursor glides (300–400 ms) read better in a reel than the default.

- 16:9 and 1:1 reels: record at a desktop size (1440 × 900).
- 9:16 (stories): record at a phone size (390 × 844), or the window ends up small in a tall frame.

Then add zooms that follow the mouse, in Recording Studio (**Zoom on clicks** does most of it) or
by writing `<name>.edit.json` (see html-recording's studio section). The reel plays each take
through its edit.

## 3. Lay out the reel

A reel is `<name>.reel.json` beside the takes it uses:

```json
{
  "version": 1,
  "shape": "16:9",
  "background": "dusk",
  "cards": "light",
  "brand": { "mark": null },
  "scenes": [
    { "id": "a", "type": "opener", "title": "New in DAISY", "sub": "One app, every client", "duration": 3000 },
    { "id": "b", "type": "card", "text": "Pick a client from the sidebar", "duration": 2000 },
    { "id": "c", "type": "demo", "take": "tenancy-switch.json", "from": 1200, "to": 7000 },
    { "id": "z", "type": "outro", "text": "enterpriseaigroup.com", "duration": 2500 }
  ]
}
```

- `shape`: `16:9` (X and LinkedIn posts, YouTube, a website hero), `1:1` (LinkedIn and Instagram
  feeds), `9:16` (Stories, Reels, TikTok, Shorts).
- `background` behind the demo windows: `dusk`, `sand`, `ink` or `brand`. `cards`: `light` or `dark`.
- `brand.mark`: a logo image URL or a path beside the reel; a plain mark otherwise.
- A demo's `take` is the recording's path relative to the reel; `from`/`to` are ms of the raw take;
  `window` (0.5–0.96) is its share of the width. Its length is the edited length of that part.

Or let the studio start it: **Reels → New reel** builds an opener, a card and a demo per take in
the folder, and an outro.

## 4. Hand it to the user in the studio

```bash
npx html-recording studio <folder>       # then Reels
```

They reorder scenes by dragging, edit card text in place, drag a scene's right edge on the
timeline to change its length (a demo's end in its take), pick the background, shape and card
style, and jump to **Edit the take** to change its zooms. Don't iterate on numbers in chat once the
studio is open.

## 5. Export

From the studio (**Export MP4**, **HTML**) or the command line:

```bash
npx html-recording reel <name>.reel.json --mp4 <name>.mp4      # needs ffmpeg
npx html-recording reel <name>.reel.json --single <name>.html
```

The MP4 is rendered frame by frame from the same player at full size (1920 × 1080 for 16:9), so it
matches the HTML exactly; a 35-second reel takes about a minute. The HTML file holds the player,
the reel, its takes and their assets, and opens from disk. On a site, the player is
`tools/player/reel.js` (`<html-reel src="name.reel.json" controls>`), beside
`rrweb-replay.min.js` and `edits.js`.

Before sending it on, watch it once end to end, or check frames: `ffmpeg -i name.mp4 -vf
"fps=1,scale=480:-1,tile=4x6" -frames:v 1 sheet.jpg`. Every card should be readable in its time,
and every demo should show what its card says.
