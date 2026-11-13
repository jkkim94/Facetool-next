/**
 * GET /api/speakers?run={runName}
 * FastAPI 프록시 + 로컬 디스크 fallback (백엔드 미연결 시)
 */

import { EPOCH_API_BASE, ENABLE_LOCAL_RESULTS } from '../backendConfig'
import { listSpeakersFromDisk, normalizeSpeakers } from '../resultsConfig'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function localResponse(run) {
  return Response.json({
    success: true,
    speakers: listSpeakersFromDisk(run),
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
        { success: false, error: 'run parameter is required', speakers: null },
        { status: 400 },
      )
    }

    if (ENABLE_LOCAL_RESULTS) {
      return localResponse(run)
    }

    const apiUrl = `${EPOCH_API_BASE}/api/speakers?run=${encodeURIComponent(run)}`
    console.log(`[API/speakers] Requesting: ${apiUrl}`)

    try {
      const res = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      })

      if (res.ok) {
        const data = await res.json()
        const speakers = normalizeSpeakers(data.speakers ?? data)
        return Response.json({
          success: true,
          speakers,
          run,
          source: 'backend',
        })
      }
      console.warn(`[API/speakers] Backend HTTP ${res.status} for ${run}, using local disk`)
    } catch (fetchErr) {
      console.warn(`[API/speakers] Backend unreachable for ${run}:`, fetchErr.message)
    }

    return localResponse(run)
  } catch (error) {
    console.error('[API/speakers] Error:', error)
    return Response.json({
      success: true,
      speakers: { count: 1, names: ['Speaker 0'], indices: [0] },
      run: '',
      source: 'fallback',
      warning: error.message,
    })
  }
}
