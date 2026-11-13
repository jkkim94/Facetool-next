import { NextResponse } from 'next/server'

const SERVE_URL = process.env.RIGLOGIC_SERVE_URL || 'http://127.0.0.1:8765'

export const dynamic = 'force-dynamic'

function stripHtmlError(text: string): string {
  if (!text || !/<!doctype html/i.test(text)) return text
  if (/404 Not Found/i.test(text)) {
    return (
      'serve.py에 POST /eval_gui_rig가 없습니다. 8765 포트 프로세스를 종료한 뒤 '
      + 'python serve.py를 다시 실행하세요.'
    )
  }
  return 'serve.py 오류 (HTML 응답)'
}

/** POST { values } -> RLRG binary (single frame bs + jo) */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const r = await fetch(`${SERVE_URL}/eval_gui_rig`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    if (!r.ok) {
      const text = await r.text()
      let message = stripHtmlError(text)
      try {
        const j = JSON.parse(text) as { error?: string }
        message = j.error || message
      } catch {
        /* keep message */
      }
      return NextResponse.json(
        { error: message || `serve.py ${r.status}` },
        { status: r.status },
      )
    }

    const buf = await r.arrayBuffer()
    const headers = new Headers({ 'Content-Type': 'application/octet-stream' })
    for (const key of ['X-Frame-Count', 'X-Bs-Count', 'X-Jo-Count', 'X-Eval-Total-Ms']) {
      const v = r.headers.get(key)
      if (v) headers.set(key, v)
    }
    return new NextResponse(buf, { status: 200, headers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `serve.py unreachable (${SERVE_URL}): ${msg}` },
      { status: 502 },
    )
  }
}

export async function GET() {
  try {
    const r = await fetch(`${SERVE_URL}/eval_columns`, { cache: 'no-store' })
    const text = await r.text()
    if (!r.ok) {
      return NextResponse.json({ error: stripHtmlError(text) }, { status: r.status })
    }
    const j = JSON.parse(text) as { endpoints?: string[] }
    const ok = Array.isArray(j.endpoints)
      && j.endpoints.some((e) => String(e).includes('eval_gui_rig'))
    return NextResponse.json({ available: ok, endpoints: j.endpoints ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `serve.py unreachable (${SERVE_URL}): ${msg}` },
      { status: 502 },
    )
  }
}
