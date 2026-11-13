/**
 * ============================================================================
 * API Route: 결과 폴더 목록 조회
 * ============================================================================
 *
 * - ENABLE_LOCAL_RESULTS=1 이면 RESULTS_BASE_PATH에서 results_* 폴더 스캔 (새 구조)
 * - 아니면 FastAPI /api/runs 프록시 (타임아웃 후 로컬 디스크 fallback)
 * - 백엔드·로컬 run 목록은 id 기준 병합
 * ============================================================================
 */

import { listRunsFromDisk } from '../resultsConfig'
import {
  EPOCH_API_BASE,
  ENABLE_LOCAL_RESULTS,
  fetchBackend,
} from '../backendConfig'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function runId(entry) {
  if (typeof entry === 'string') return entry.trim()
  if (entry && typeof entry === 'object') {
    return String(entry.id ?? entry.name ?? entry.run ?? '').trim()
  }
  return ''
}

/** 백엔드 run 객체/문자열 + 로컬 폴더명 병합 */
function mergeRunLists(backendRuns, localIds) {
  const merged = [...(backendRuns || [])]
  const seen = new Set(merged.map(runId).filter(Boolean))
  for (const id of localIds || []) {
    const trimmed = String(id).trim()
    if (!trimmed || seen.has(trimmed)) continue
    merged.push(trimmed)
    seen.add(trimmed)
  }
  return merged
}

function emptyRunsError(backendError) {
  const base = process.env.RESULTS_BASE_PATH || 'E:\\'
  const hint =
    `백엔드(${EPOCH_API_BASE}) 연결 실패 또는 run 없음. ` +
    `VPN/학습 서버 확인, 또는 ${base}results_* 폴더를 두고 ENABLE_LOCAL_RESULTS=true`
  if (backendError) return `${backendError} — ${hint}`
  return hint
}

function localDiskResponse(extra = {}) {
  const runs = listRunsFromDisk()
  return {
    success: runs.length > 0,
    runs,
    baseDir: process.env.RESULTS_BASE_PATH || 'E:\\',
    error: runs.length > 0 ? null : emptyRunsError(null),
    ...extra,
  }
}

export async function GET() {
  try {
    const startTime = Date.now()
    const localIds = listRunsFromDisk()

    if (ENABLE_LOCAL_RESULTS) {
      console.log('[API Route/runs] Scanning local results_* folders')
      const body = localDiskResponse({ source: 'local' })
      console.log(
        `[API Route/runs] Found ${body.runs.length} runs in ${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      )
      return Response.json(body, { status: body.success ? 200 : 503 })
    }

    console.log('[API Route/runs] Requesting runs list from FastAPI')
    let backendRuns = []
    let backendError = null

    try {
      const res = await fetchBackend('/api/runs', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      const endTime = Date.now()
      console.log(`[API Route/runs] Response in ${((endTime - startTime) / 1000).toFixed(2)}s`)

      if (res.ok) {
        const data = await res.json()
        backendRuns = data.runs || []
        if (data.error) backendError = String(data.error)
      } else {
        let errorData
        try {
          const text = await res.text()
          errorData = JSON.parse(text)
        } catch {
          errorData = { error: res.statusText || `HTTP ${res.status} Error` }
        }
        backendError = errorData.detail || errorData.error || `HTTP ${res.status}`
        console.warn('[API Route/runs] Backend failed:', backendError)
      }
    } catch (err) {
      backendError = err instanceof Error ? err.message : String(err)
      console.warn('[API Route/runs] Backend unreachable:', backendError)
    }

    const runs = mergeRunLists(backendRuns, localIds)
    if (runs.length > 0) {
      return Response.json({
        success: true,
        runs,
        baseDir: process.env.RESULTS_BASE_PATH || 'E:\\',
        error: null,
        source: backendRuns.length > 0 ? (localIds.length > 0 ? 'merged' : 'backend') : 'local_fallback',
        backendWarning: backendError,
      })
    }

    return Response.json(
      {
        success: false,
        runs: [],
        error: emptyRunsError(backendError),
        baseDir: process.env.RESULTS_BASE_PATH || 'E:\\',
      },
      { status: 503 },
    )
  } catch (error) {
    console.error('[API Route/runs] Error:', error)
    const body = localDiskResponse({
      error: emptyRunsError(error instanceof Error ? error.message : String(error)),
      source: 'local_fallback',
    })
    return Response.json(body, { status: body.success ? 200 : 500 })
  }
}
