# Skills

Agent skills by [Gareth Chainey](https://garethchainey.com). They work with Claude Code, Codex, Cursor and any agent that reads `SKILL.md`.

| Skill | What it does |
| --- | --- |
| [html-recording](skills/html-recording) | Record a web page or prototype as HTML instead of video: the real DOM, replayed in the page, sharp at any zoom and around 1% of the size. [Why](https://garethchainey.com/replay-vs-video) |
| [sizzle-reel](skills/sizzle-reel) | A feature video the way Cursor makes them: a short card, then a demo of exactly that, repeated. Built on html-recording; tuned in Recording Studio's Reels view; exported as MP4 or HTML. |
| [design-principles-review](skills/design-principles-review) | Critique a UI against the 13 graphic design principles, with a measured style audit, a pass/warn/fail table, a fix-first list, and an annotated critique board plus fixes frame in Paper. |

## Install

```bash
npx skills add GChainey/skills --skill html-recording -g
npx skills add GChainey/skills --skill sizzle-reel -g
npx skills add GChainey/skills --skill design-principles-review -g
```

Or download [html-recording.zip](https://garethchainey.com/downloads/html-recording.zip) and unzip it into `~/.claude/skills`.

### html-recording in a project

The recorder and Recording Studio are also an npm package, so a repo's clip scripts can import it
by name and run on any machine or in CI:

```bash
npm i -D html-recording
npx html-recording setup
npx html-recording studio recordings
```

See [skills/html-recording/README.md](skills/html-recording/README.md).

## License

MIT

## Maintaining

Edit a skill under `skills/`, push, then rebuild the site's download with
`scripts/pack.sh html-recording ~/path/to/portfoliowebsite/public/downloads/html-recording.zip`.
Installed copies update with `npx skills update`.

To release html-recording to npm: bump `version` in `skills/html-recording/package.json`, then
`cd skills/html-recording && npm publish`. Rebuild the studio first if it changed
(`cd studio && npm run build`).
