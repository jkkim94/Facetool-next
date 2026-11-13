import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3300'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const logs = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`))

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'RigLogic 재생' }).click()
  await page.getByRole('button', { name: '라이브 (베이크 없음)' }).click()

  // Select subgroup BEFORE stream completes
  const sel = page.locator('select[title="head mesh vertex debug colors"]')
  await sel.waitFor({ timeout: 30000 })
  await sel.selectOption('lip_mask')

  await page.waitForTimeout(15000)
  await page.screenshot({ path: 'tools/_lip_early_subgroup_live.png' })

  const body = await page.evaluate(() => ({
    status: document.body.innerText.match(/ready|스트리밍|오류[^\n]*/)?.[0],
    hasCanvas: !!document.querySelector('canvas'),
    canvasSize: (() => {
      const c = document.querySelector('canvas')
      return c ? [c.width, c.height] : null
    })(),
    lipVerts: document.body.innerText.match(/(\d+) verts/)?.[1],
  }))

  console.log('Early subgroup select:', JSON.stringify(body, null, 2))
  const errLogs = logs.filter((l) => /error|Error|warn|WebGL|THREE/i.test(l))
  console.log('Errors/warnings:', errLogs.slice(0, 20))
  await browser.close()
}

main().catch(console.error)
