/**
 * Per-vertex displacement (cm) when selected GUI control(s) are driven to 1.0.
 * Uses same-origin Next.js proxy (no CORS to serve.py :8765).
 * @param {number[]} controlIndices
 * @returns {Promise<{ headVertexCount: number, maxCm: number, deltas: number[] }|null>}
 */
export async function fetchControlDeltas(controlIndices) {
  if (!controlIndices?.length) return null
  try {
    const r = await fetch('/api/riglogic/control_deltas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices: controlIndices }),
      cache: 'no-store',
    })
    if (!r.ok) return null
    return r.json()
  } catch {
    return null
  }
}

/** Count vertices at or above threshold. */
export function countAboveThreshold(deltas, minCm) {
  if (!deltas?.length) return 0
  let n = 0
  for (let i = 0; i < deltas.length; i++) {
    if (deltas[i] >= minCm) n++
  }
  return n
}
