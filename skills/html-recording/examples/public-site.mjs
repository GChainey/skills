import { record } from '../tools/rrlib.mjs'

// Recording a public site (the Dispatch and Thesis clips on the portfolio): the app mock-up on each product's landing page, in dark mode: scrolled so the app fills the
// screen, then a few things done in it. Prints a 16:10 region around the app for the crop.
const viewport = { width: 1440, height: 900 }

async function frame(r, ids) {
  const { page } = r
  // The page's own caption pill under the app would peek in at the bottom
  await page.evaluate(() => document.querySelectorAll('p, span, div').forEach((el) => { if (el.children.length === 0 && /^(Watch it land on the Kindle|Every underlined sentence is an assumption)/.test(el.textContent.trim())) el.style.visibility = 'hidden' }))
  // Everything the app shows (Dispatch's Kindle hangs off the window), centred on the screen
  const union = () => page.evaluate((ids) => {
    const rs = ids.map((id) => document.getElementById(id).getBoundingClientRect())
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top))
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y }
  }, ids)
  // It can move with the scroll (parallax), so measure and correct until it sits still
  let b = await union()
  for (let i = 0; i < 5 && Math.abs(b.y + b.height / 2 - 450) > 1; i++) {
    await page.evaluate((dy) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo({ top: window.scrollY + dy, behavior: 'instant' }) }, b.y + b.height / 2 - 450)
    await r.wait(800)
    b = await union()
  }
  // 16:10 around it with an even margin, centred on it
  const pad = 40
  let w = b.width + pad * 2, h = b.height + pad * 2
  if (w / h > 1.6) h = w / 1.6; else w = h * 1.6
  r.region = { x: Math.round(b.x + b.width / 2 - w / 2), y: Math.round(b.y + b.height / 2 - h / 2), width: Math.round(w), height: Math.round(h) }
  console.log(ids.join('+'), JSON.stringify(b), 'region', JSON.stringify(r.region))
}

const which = process.argv[2]

if (!which || which === 'dispatch') { const ORIGIN = 'https://www.dispatchmac.com'; await record('dispatch-app', async (r) => {
  const { page } = r
  await r.goto('https://www.dispatchmac.com')
  await r.wait(1500)
  await frame(r, ['hero-app', 'hero-kindle'])
  await r.start()
  await r.wait(1200)
  const stage = page.locator('#stage-hero')
  await r.click(stage.getByRole('button', { name: 'Dispatch', exact: true }), { after: 3800 })
  await r.click(stage.getByRole('button', { name: /The Last Quiet Bar in Town/ }), { after: 900 })
  await r.click(stage.getByRole('button', { name: 'Dispatch', exact: true }), { after: 3800 })
}, { viewport, colorScheme: 'dark', origins: [ORIGIN] }) }

if (!which || which === 'thesis') { const ORIGIN = 'https://thesis-phi-self.vercel.app'; await record('thesis-app', async (r) => {
  const { page } = r
  await r.goto('https://thesis-phi-self.vercel.app')
  await r.wait(1500)
  await frame(r, ['prose-app'])
  await r.start()
  await r.wait(1200)
  const stage = page.locator('#stage-prose')
  await r.click(stage.getByRole('button', { name: /Teams agree on what to test first/ }), { after: 3200 })
  await r.click(stage.getByRole('button', { name: /Teams will pay once three people/ }), { after: 3200 })
  await r.click(stage.getByRole('button', { name: /Remote product teams lose weeks/ }), { after: 3200 })
}, { viewport, colorScheme: 'dark', origins: [ORIGIN] }) }
