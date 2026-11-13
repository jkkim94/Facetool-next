import { NextResponse } from 'next/server'

const SERVE_URL = process.env.RIGLOGIC_SERVE_URL || 'http://127.0.0.1:8765'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function stripHtmlError(text: string): string {
  if (!text || !/<!doctype html/i.test(text)) return text
  if (/404 Not Found/i.test(text)) {
    return (
      'serve.py에 해당 API가 없습니다. 8765 포트 프로세스를 모두 종료한 뒤 '
      + 'python serve.py를 다시 실행하세요. '
      + '(시작 로그: "POST /eval_columns/batch")'
    )
  }
  return 'serve.py 오류 (HTML 응답)'
}

/** GET — health 또는 session frames (?session=&start=&count=) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const session = searchParams.get('session')

  if (session) {
    const start = searchParams.get('start') ?? '0'
    const count = searchParams.get('count') ?? '30'
    const qs = new URLSearchParams({ session, start, count })
    try {
      const r = await fetch(`${SERVE_URL}/eval_columns/frames?${qs}`, {
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
      for (const key of ['X-Start', 'X-End', 'X-Count', 'X-Stride']) {
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

  try {
    const r = await fetch(`${SERVE_URL}/eval_columns`, { cache: 'no-store' })
    const text = await r.text()
    if (!r.ok) {
      return NextResponse.json({ error: stripHtmlError(text) }, { status: r.status })
    }
    return NextResponse.json(JSON.parse(text))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { error: `serve.py unreachable (${SERVE_URL}): ${msg}` },
      { status: 502 },
    )
  }
}

/**
 * POST body.mode:
 *   batch    — { columns, rows } block eval (권장)
 *   register — { columns, rows } full session
 *   (없음)   — { columns, values } single frame
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const mode = body.mode
  let servePath = '/eval_columns'
  if (mode === 'batch') servePath = '/eval_columns/batch'
  else if (mode === 'register') servePath = '/eval_columns/register'
  else if (Array.isArray(body.rows)) servePath = '/eval_columns/batch'

  const isJsonResponse = servePath.includes('register')

  try {
    const r = await fetch(`${SERVE_URL}${servePath}`, {
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

    if (isJsonResponse) {
      return NextResponse.json(await r.json())
    }

    const buf = await r.arrayBuffer()
    const headers = new Headers({ 'Content-Type': 'application/octet-stream' })
    for (const key of ['X-Count', 'X-Stride', 'X-Eval-Total-Ms']) {
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
