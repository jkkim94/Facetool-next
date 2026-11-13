/**
 * GET /api/checkpoints?run={runName}
 * FastAPI 프록시 + 로컬 디스크 fallback (백엔드 미연결 시)
 */

import { EPOCH_API_BASE, ENABLE_LOCAL_RESULTS } from '../backendConfig'
import { listCheckpointsFromDisk } from '../resultsConfig'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function localResponse(run) {
  const checkpoints = listCheckpointsFromDisk(run)
  return Response.json({
    success: true,
    checkpoints,
    run,
    source: 'local',
  })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const run = searchParams.get('run') || ''

    if (!run) {
      return Response.json(
        { success: false, error: 'run parameter is required', checkpoints: [] },
        { status: 400 },
      )
    }

    if (ENABLE_LOCAL_RESULTS) {
      return localResponse(run)
    }

    const apiUrl = `${EPOCH_API_BASE}/api/checkpoints?run=${encodeURIComponent(run)}`
    console.log(`[API/checkpoints] Requesting: ${apiUrl}`)

    try {
      const res = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      })

      if (res.ok) {
        const data = await res.json()
        const checkpoints = data.checkpoints || []
        if (checkpoints.length > 0) {
          return Response.json({
            success: true,
            checkpoints,
            run,
            source: 'backend',
          })
        }
        console.warn(`[API/checkpoints] Backend returned empty list for ${run}, using local disk`)
      } else {
        console.warn(`[API/checkpoints] Backend HTTP ${res.status} for ${run}, using local disk`)
      }
    } catch (fetchErr) {
      console.warn(`[API/checkpoints] Backend unreachable for ${run}:`, fetchErr.message)
    }

    return localResponse(run)
  } catch (error) {
    console.error('[API/checkpoints] Error:', error)
    return Response.json(
      { success: false, checkpoints: ['best.pt'], error: error.message, source: 'fallback' },
      { status: 200 },
    )
  }
}
