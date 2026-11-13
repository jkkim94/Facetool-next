/**
 * POST /api/inference — 오디오 → Blendshape (FastAPI 프록시 또는 로컬 ONNX)
 * @see docs/FRONT_BACKEND_CONTRACT.md
 */

import { EPOCH_API_BASE, ENABLE_LOCAL_ONNX } from '../backendConfig'
import { normalizeInferenceResponse } from '@/lib/inference/normalizeInferenceResponse'
import { runOnnxInference } from '@/lib/runOnnxInference'
import type {
  ApiErrorBody,
  InferenceRequestBody,
  RawInferencePayload,
} from '@/types/api'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function shouldUseLocalOnnx(run: string | undefined): boolean {
  if (!ENABLE_LOCAL_ONNX) return false
  if (run && run !== 'local_onnx') return false
  return true
}

function resolveCheckpoint(run: string, checkpoint: string | undefined): string {
  if (checkpoint?.trim()) return checkpoint.trim()
  if (run === 'pretrained') return 'UniTalker-B-D0-D7.pt'
  return 'best.pt'
}

function errorResponse(error: string, status: number): Response {
  const body: ApiErrorBody = { success: false, error }
  return Response.json(body, { status })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as InferenceRequestBody
    const {
      run,
      checkpoint,
      speaker,
      audio,
      audio_base64,
      enable_eye_blink,
      source_audio_filename,
    } = body

    const audioBase64 = audio_base64 ?? audio
    if (!audioBase64) {
      return errorResponse('audio_base64 (or audio) is required', 400)
    }

    if (shouldUseLocalOnnx(run)) {
      console.log('[API/inference] Using local ONNX (no trainFramework run)')
      try {
        const local = await runOnnxInference({ audioBase64 })
        return Response.json(
          normalizeInferenceResponse({ ...local, source: 'local_onnx' })
        )
      } catch (localErr) {
        const message =
          localErr instanceof Error ? localErr.message : '로컬 ONNX 추론 실패'
        console.error('[API/inference] local ONNX failed:', localErr)
        return errorResponse(message, 500)
      }
    }

    if (!run) {
      return errorResponse(
        'run is required for trainFramework inference. Set run/checkpoint/speaker, or ENABLE_LOCAL_ONNX=true without run for local ONNX only.',
        400
      )
    }

    const resolvedCheckpoint = resolveCheckpoint(run, checkpoint)
    const backendBody: Record<string, unknown> = {
      audio_base64: audioBase64,
      run,
      checkpoint: resolvedCheckpoint,
      speaker: speaker ?? 0,
    }
    if (enable_eye_blink !== undefined) {
      backendBody.enable_eye_blink = enable_eye_blink
    }
    if (source_audio_filename?.trim()) {
      backendBody.source_audio_filename = source_audio_filename.trim()
    }
    if (body.compare_vanilla !== undefined) {
      backendBody.compare_vanilla = body.compare_vanilla
    }

    const apiUrl = `${EPOCH_API_BASE}/api/inference`
    console.log(
      `[API/inference] Requesting: ${apiUrl} run='${run}' checkpoint='${resolvedCheckpoint}' speaker=${backendBody.speaker}`
    )

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120_000)

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendBody),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      let errorData: Record<string, unknown> = {}
      try {
        errorData = (await res.json()) as Record<string, unknown>
      } catch {
        errorData = { error: `HTTP ${res.status}` }
      }
      const raw =
        errorData.detail ??
        errorData.error ??
        errorData.message ??
        `HTTP ${res.status}`
      let errorMessage =
        typeof raw === 'string'
          ? raw
          : ((raw as { message?: string })?.message ??
            JSON.stringify(raw))
      if (res.status === 503) {
        errorMessage =
          errorMessage && !/^HTTP \d+$/.test(errorMessage)
            ? `추론 서비스를 사용할 수 없습니다. (${errorMessage})`
            : '추론 서비스를 사용할 수 없습니다. 백엔드 서버가 응답하지 않습니다. 서버 상태를 확인하세요.'
      }
      return errorResponse(errorMessage, res.status)
    }

    const data = (await res.json()) as RawInferencePayload
    return Response.json(normalizeInferenceResponse(data))
  } catch (error) {
    console.error('[API/inference] Error:', error)
    let msg = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && error.name === 'AbortError') {
      msg = '추론 요청 시간이 초과되었습니다. 백엔드/추론 서버 상태를 확인하세요.'
    } else if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
    ) {
      msg = '백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.'
    }
    return errorResponse(msg, 500)
  }
}
