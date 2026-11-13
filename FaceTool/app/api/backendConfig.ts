/**
 * 백엔드(SSH/원격) API 연결 설정.
 * @see docs/BACKEND_CONNECTION.md
 */

const TRUTHY = new Set(['1', 'true', 'yes'])

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v !== undefined && TRUTHY.has(v)
}

export const EPOCH_API_BASE =
  process.env.EPOCH_API_URL?.trim() || 'http://172.30.1.21:8000'

export const BACKEND_FETCH_TIMEOUT_MS = (() => {
  const n = Number(process.env.BACKEND_FETCH_TIMEOUT_MS || 5000)
  return Number.isFinite(n) && n > 0 ? n : 5000
})()

/** FastAPI fetch with timeout (runs/checkpoints 등 BFF 프록시용) */
export async function fetchBackend(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${EPOCH_API_BASE}${path}`
  return fetch(url, {
    ...init,
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
  })
}

export const ENABLE_LOCAL_RESULTS = envFlag('ENABLE_LOCAL_RESULTS')

export const ENABLE_LOCAL_ONNX = envFlag('ENABLE_LOCAL_ONNX')

/** 설정된 경우에만 반환 (D10 등 삭제된 기본 경로 없음) */
export function getOnnxModelPath(): string | null {
  const p = process.env.ONNX_MODEL_PATH?.trim()
  return p || null
}

/** 레거시 import 호환 — 미설정 시 null */
export const ONNX_MODEL_PATH: string | null = getOnnxModelPath()
