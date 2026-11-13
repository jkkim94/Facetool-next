import { NextResponse } from 'next/server'

const SERVE_URL = process.env.RIGLOGIC_SERVE_URL || 'http://127.0.0.1:8765'

export const dynamic = 'force-dynamic'

function stripHtmlError(text: string): string {
  if (!text || !/<!doctype html/i.test(text)) return text
  if (/404 Not Found/i.test(text)) {
    return (
      'serve.py에 GET /deform_static이 없습니다. 8765 포트 프로세스를 종료한 뒤 '
      + 'python serve.py를 다시 실행하세요.'
    )
  }
  return 'serve.py 오류 (HTML 응답)'
}

export async function GET() {
  try {
    const r = await fetch(`${SERVE_URL}/deform_static`, { cache: 'no-store' })
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
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `serve.py unreachable (${SERVE_URL}): ${msg}` },
      { status: 502 },
    )
  }
}
