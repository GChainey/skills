# Skills

Agent skills by [Gareth Chainey](https://garethchainey.com). They work with Claude Code, Codex, Cursor and any agent that reads `SKILL.md`.

| Skill | What it does |
| --- | --- |
| [html-recording](skills/html-recording) | Record a web page or prototype as HTML instead of video: the real DOM, replayed in the page, sharp at any zoom and around 1% of the size. [Why](https://garethchainey.com/replay-vs-video) |

## Install

```bash
npx skills add GChainey/skills --skill html-recording -g
```

Or download [html-recording.zip](https://garethchainey.com/downloads/html-recording.zip) and unzip it into `~/.claude/skills`.

## License

MIT

## Maintaining

Edit a skill under `skills/`, push, then rebuild the site's download with
`scripts/pack.sh html-recording ~/path/to/portfoliowebsite/public/downloads/html-recording.zip`.
Installed copies update with `npx skills update`.
