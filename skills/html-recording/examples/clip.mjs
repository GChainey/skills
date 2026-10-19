// A clip script: drive the page like a person would, and record it as HTML.
// Copy it next to your work, change the steps, then:
//   BASE_URL=http://localhost:3000 RR_OUT=recordings node clip.mjs [clip-name]
// (Change the import to this skill's tools/rrlib.mjs path when you copy it elsewhere.)
import { record } from '../tools/rrlib.mjs'

const which = process.argv[2]

// One record() per clip; pick one by name, or run them all
if (!which || which === 'settings') await record('settings', async (r) => {
  const { page } = r // the Playwright page, for locators
  await r.goto('/')
  // Set the scene before start(): nothing before it is recorded
  await r.css('.cookie-banner { display: none !important }')
  await r.start()
  await r.wait(600) // a beat on the first frame
  await r.click(page.getByRole('button', { name: 'Settings' }), { after: 900 })
  await r.click(page.getByRole('tab', { name: 'Team' }), { after: 1200 })
  await r.type(page.getByRole('textbox', { name: 'Invite by email' }), 'sam@example.com')
  await r.click(page.getByRole('button', { name: 'Send invite' }), { after: 1500 })
})

// A crop to one part of the screen, with an AI answer sped up while it streams in
if (!which || which === 'ask') await record('ask', async (r) => {
  const { page } = r
  await r.goto('/assistant')
  await r.start()
  await r.type(page.getByRole('textbox', { name: 'Ask' }), 'What changed this week?')
  await page.keyboard.press('Enter')
  await r.fast(4, () => page.getByTestId('answer-done').waitFor({ timeout: 60000 }))
  await r.focus(page.getByRole('region', { name: 'Assistant' }), { pad: 24 })
  await r.wait(2000) // hold the end so it can be read before it loops
}, { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
