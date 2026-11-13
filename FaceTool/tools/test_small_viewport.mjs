import { chromium } from 'playwright'

async function testViewport(h, w) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://127.0.0.1:3300', { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByRole('button', { name: 'RigLogic 재생' }).click()
  await page.getByRole('button', { name: '라이브 (베이크 없음)' }).click()
  await page.waitForTimeout(8000)
  const sel = page.locator('select[title="head mesh vertex debug colors"]')
  await sel.selectOption('lip_mask')
  await page.waitForTimeout(3000)
  const dims = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const mount = c?.parentElement
    return {
      canvas: c ? [c.clientWidth, c.clientHeight] : null,
      mount: mount ? [mount.clientWidth, mount.clientHeight] : null,
    }
  })
  await page.screenshot({ path: `tools/_lip_small_${w}x${h}.png` })
  await browser.close()
  console.log(`${w}x${h}:`, dims)
}

for (const [w, h] of [[800, 600], [400, 300], [320, 568]]) {
  await testViewport(h, w)
}
