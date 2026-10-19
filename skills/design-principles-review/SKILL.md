---
name: design-principles-review
description: Critique a UI design (Paper frame, live page, or two variants side by side) against the 13 graphic design principles (alignment, contrast, balance, hierarchy, colour, white space, proportion, repetition, rhythm, movement, emphasis, proximity, unity), plus a style-inventory audit. Use when asked to "critique", "review the design", "go through the design principles", "audit how many styles we use", compare variants, or link figma.com/resource-library/graphic-design-principles. Produces a verdict table, a prioritised fix list, and on request an annotated critique board and a fixes frame in Paper — Paper first, no code until approved.
---

# Design principles review

Source: https://www.figma.com/resource-library/graphic-design-principles/ (13 principles). Pair it with a style inventory so findings are measured, not eyeballed.

## 1. Gather facts (measure, don't guess)
- **Paper frame:** `get_screenshot` (scale ~0.6), `get_tree_summary`, then `get_jsx` (tailwind or inline) of the hero, toolbar, table header and 1–2 representative rows. Read sizes/colours from JSX, never from screenshots.
- **Live page:** Playwright `browser_evaluate` for bounding rects (edges of toolbar vs table, column widths), computed font sizes/weights. Note the shared browser may be in use by another agent — if the URL changed under you, use a separate headless Chrome (`--headless=new --dump-dom` on a throwaway check page).
- Know the job of the page (the user's questions it must answer). Every verdict is judged against that job.

## 2. Style inventory (the "audit")
Count, from the JSX, for the main content area only:
| What | Count | Detail |
|---|---|---|
| Text styles (family/size/lh/weight, and incl. colour) | | flag off-scale sizes and duplicate line-heights |
| Colour values | | group: neutrals, red, amber, green, categorical |
| Badge/pill anatomies | | height, padding, border, dot/icon variants |
| Button styles | | height vs text size mismatches |
| Icon sizes | | |
| Dots/markers/ticks | | |
| Bar builds | | |
| Radii | | |
| Table cell anatomies | | |
Then propose simplifications with a before → after count table.

## 3. Walk the 13 principles
For each: verdict per variant — **Pass / Warn / Fail** — one concrete observation (with a measurement or element name), and one fix. Common checks:
1. Alignment — shared edges (toolbar vs table vs hero), cross-card row alignment, right-aligned column next to left-aligned column.
2. Contrast — do exceptions stand out from normal rows? Are good states quieter than bad ones?
3. Balance — empty bands (over-wide columns), weight clustered on one side.
4. Hierarchy — page title vs key numbers vs body; is the most important answer the biggest?
5. Colour — count hues; one meaning per hue; colour reserved for exceptions; categorical colour competing with status colour.
6. White space — card padding vs page padding; wasted vs well-placed space.
7. Proportion — heaviest marks (black bars, filled buttons) vs what actually matters.
8. Repetition — same thing styled the same everywhere (buttons, badges, cells, card headers).
9. Rhythm — row height regularity; does the status column create a scannable pattern?
10. Movement — where the eye goes first → second → third; does that match the page's job?
11. Emphasis — the single focal point; does it answer the main question?
12. Proximity — related signals together (e.g. two time signals for one case split across columns).
13. Unity — does it feel like one system?

## 4. Output in chat
- One-line headline verdict (which variant wins and the 2–3 cross-cutting problems).
- The 13-row table: `# | Principle | Variant A | Variant B | Fix`.
- **Fix first**: 3–5 prioritised fixes.
- Ask whether to put it in Paper.

## 5. In Paper (when asked) — never edit the user's frames
- **Critique board**: new artboard; the variants as `<x-paper-clone node-id=…>` at 1:1 inside `position:relative` 1440-wide wrappers, with numbered **pins** (24px circle, 2px white ring, 12/16 600 white number; pass #15803D, warn #B45309, fail #B91C1C) at measured frame coordinates; nudge ≤16px off text. Below: the principles table (definition under each name in 12/16 muted; verdict badges), then "Fix first".
- **Fixes frame**: duplicate the best variant and apply the fix list; then re-screenshot and compare for regressions.
- Use agents in parallel for board + frame; give them exact specs and positions (stack artboards in clear canvas space, report final position).
- Never edit the user's original frames: duplicate first, edit the copy (see the paper-safe-variation skill if installed).
- No Paper? Do the same as an HTML board or a Figma page — the structure (pinned frames → principles table → fix first) is what matters.

## Guardrails
- **Paper first.** Do not write, merge, or deploy code for design iterations until the user has seen the Paper version and explicitly asked for it to be built.
- Respect project rules found in memory (e.g. 8pt grid, alignment conventions, "Est." labelling, palette) — a fix must not break them.
- Keep verdict notes short and specific; no generic design advice.
