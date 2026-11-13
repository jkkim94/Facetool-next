import { NextResponse } from 'next/server'

const SERVE_URL = process.env.RIGLOGIC_SERVE_URL || 'http://127.0.0.1:8765'

export const dynamic = 'force-dynamic'

/** POST { values, t, male?, female? } -> float32 XYZ vertices (male↔female blend) */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const r = await fetch(`${SERVE_URL}/eval_gui_blend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!r.ok) {
      const text = await r.text()
      let message = text
      try {
        const j = JSON.parse(text) as { error?: string }
        message = j.error || message
      } catch {
        /* keep */
      }
      return NextResponse.json(
        { error: message || `serve.py ${r.status}` },
        { status: r.status },
      )
    }
    const buf = await r.arrayBuffer()
    const headers = new Headers({ 'Content-Type': 'application/octet-stream' })
    for (const key of ['X-Vertex-Count', 'X-Blend-T', 'X-Eval-Total-Ms']) {
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
    const r = await fetch(`${SERVE_URL}/identity_pair`, { cache: 'no-store' })
    const text = await r.text()
    if (!r.ok) {
      return NextResponse.json({ error: text }, { status: r.status })
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
