import { NextResponse } from 'next/server';

const SERVE_URL = process.env.RIGLOGIC_SERVE_URL || 'http://127.0.0.1:8765';

export const dynamic = 'force-dynamic';

/** Proxy to serve.py POST /control_deltas (avoids browser CORS to :8765). */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const r = await fetch(`${SERVE_URL}/control_deltas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: text || `serve.py ${r.status}` },
        { status: r.status },
      );
    }
    return NextResponse.json(JSON.parse(text));
  } catch (e) {
    return NextResponse.json(
      { error: `serve.py unreachable (${SERVE_URL}): ${e.message || e}` },
      { status: 502 },
    );
  }
}
