import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3300'

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return { ok: false, reason: 'no canvas' }
    const w = canvas.width
    const h = canvas.height
    if (w < 2 || h < 2) return { ok: false, reason: `canvas size ${w}x${h}` }
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2')
    if (!gl) return { ok: false, reason: 'no webgl context' }
    const cx = Math.floor(w / 2)
    const cy = Math.floor(h / 2)
    const px = new Uint8Array(4)
    gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const nonBg = px[0] > 30 || px[1] > 30 || px[2] > 30
    return {
      ok: true,
      size: `${w}x${h}`,
      center: [px[0], px[1], px[2], px[3]],
      hasContent: nonBg,
    }
  })
}

async function selectHighlight(page, value, live = false) {
  const sel = live
    ? page.locator('select[title="head mesh vertex debug colors"]')
    : page.locator('select').filter({ has: page.locator(`option[value="${value}"]`) }).first()
  await sel.waitFor({ timeout: 30000 })
  await sel.selectOption(value)
  await page.waitForTimeout(3000)
}

async function getOverlayText(page) {
  const overlay = page.locator('div').filter({ hasText: /LVE lip mask|lip mask/i }).first()
  if (await overlay.count() === 0) return null
  return overlay.innerText().catch(() => null)
}

async function runMode(page, mode, live = false) {
  const errors = []
  const onErr = (e) => errors.push(String(e))
  const onConsole = (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) }
  page.on('pageerror', onErr)
  page.on('console', onConsole)

  await selectHighlight(page, mode, live)
  const overlay = await getOverlayText(page)
  const shot = `tools/_lip_${mode}_${live ? 'live' : 'gui'}.png`
  await page.screenshot({ path: shot, fullPage: false })
  page.off('pageerror', onErr)
  page.off('console', onConsole)
  return { mode, live, overlay: overlay?.slice(0, 200), shot, errors }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const loadErrors = []
  page.on('pageerror', (e) => loadErrors.push(String(e)))

  console.log('Opening FaceTool RigLogic tab...')
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  await page.getByRole('button', { name: 'RigLogic 재생' }).click()
  await page.getByRole('button', { name: 'GUI 조작' }).click()

  console.log('Waiting for mesh load (GUI)...')
  await page.waitForFunction(() => /ready|오류/.test(document.body.innerText), { timeout: 120000 })
  await page.waitForTimeout(2000)
  const statusGui = await page.locator('span').filter({ hasText: /ready|오류|연결/ }).first().innerText().catch(() => '?')
  console.log('GUI status:', statusGui)

  const baseline = await sampleCanvas(page)
  console.log('Baseline (texture):', JSON.stringify(baseline))

  const subgroup = await runMode(page, 'lip_mask', false)
  console.log('GUI Subgroup:', JSON.stringify(subgroup, null, 2))

  const single = await runMode(page, 'lip_mask_single', false)
  console.log('GUI Single:', JSON.stringify(single, null, 2))

  // Live viewer (dropdown in toolbar)
  await page.getByRole('button', { name: '라이브 (베이크 없음)' }).click()
  await page.waitForFunction(() => /ready|스트리밍|오류/.test(document.body.innerText), { timeout: 120000 })
  await page.waitForTimeout(5000)
  const liveSubgroup = await runMode(page, 'lip_mask', true)
  console.log('Live Subgroup:', JSON.stringify(liveSubgroup, null, 2))
  const liveSingle = await runMode(page, 'lip_mask_single', true)
  console.log('Live Single:', JSON.stringify(liveSingle, null, 2))

  if (loadErrors.length) console.log('Load errors:', loadErrors)

  await browser.close()

  const subgroupOk = subgroup.shot && subgroup.errors.length === 0
  const singleOk = single.shot && single.errors.length === 0
  console.log('Screenshots saved to tools/_lip_*.png')
  if (!subgroupOk && singleOk) {
    console.error('FAIL: subgroup errors but single ok', subgroup.errors)
    process.exit(1)
  }
  console.log('PASS: browser verification complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(3)
})
