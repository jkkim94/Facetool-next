/**
 * ============================================================================
 * API Route: 에폭/클립 목록 조회
 * ============================================================================
 *
 * - ENABLE_LOCAL_RESULTS=1 이면 run/blendshape_samples/best + inference_debug 내 클립 기준명 목록
 * - 아니면 FastAPI /api/epochs 프록시 (기존 epoch_숫자 폴더 목록)
 * ============================================================================
 */

import { listClipsInBestFolder, listAllEpochFolders } from '../../resultsConfig'
import { EPOCH_API_BASE, ENABLE_LOCAL_RESULTS } from '../../backendConfig'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const run = searchParams.get('run') || ''

    if (ENABLE_LOCAL_RESULTS) {
      if (!run) {
        return new Response(
          JSON.stringify({ success: false, error: 'run is required in local mode' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      // blendshape_samples 서브폴더 + inference_debug 포함
      const epochs = listClipsInBestFolder(run)
      // 폴더 레벨 목록 (best, best1, inference_debug 등)도 함께 반환
      const folderNames = listAllEpochFolders(run)
      return Response.json({
        success: true,
        epochs: epochs.length > 0 ? epochs : folderNames,
        folders: epochs.length > 0 ? epochs : folderNames,
        basePath: run,
        error: null
      })
    }

    const startTime = Date.now()
    const query = run ? `?run=${encodeURIComponent(run)}` : ''
    console.log(`[API Route/epoch/list] Requesting epochs from FastAPI (run: ${run || '(omit, backend uses first)'})`)
    const apiUrl = `${EPOCH_API_BASE}/api/epochs${query}`
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })

    const endTime = Date.now()
    console.log(`[API Route/epoch/list] ⏱️ Response in ${((endTime - startTime) / 1000).toFixed(2)}s`)

    if (!res.ok) {
      let errorData
      try {
        const text = await res.text()
        errorData = JSON.parse(text)
      } catch {
        errorData = { error: res.statusText || `HTTP ${res.status} Error` }
      }
      return new Response(
        JSON.stringify({ success: false, error: errorData.detail || errorData.error || 'Failed to list epoch folders' }),
        { status: res.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await res.json()
    const epochs = data.epochs || data.folders || []
    return Response.json({
      success: data.success,
      epochs,
      folders: epochs,
      basePath: data.basePath,
      error: data.error
    })
  } catch (error) {
    console.error('[API Route/epoch/list] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

