/**
 * 브라우저용 typed fetch (BFF /api/*)
 */

import type {
  ApiErrorBody,
  CheckpointsResponse,
  InferenceConfigBody,
  InferenceRequestBody,
  InferenceResponse,
  RunsResponse,
  SpeakersResponse,
} from '@/types/api'

async function parseJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>
}

export async function fetchRuns(): Promise<RunsResponse> {
  const res = await fetch('/api/runs', { cache: 'no-store' })
  return parseJson<RunsResponse>(res)
}

export async function fetchCheckpoints(run: string): Promise<CheckpointsResponse> {
  const res = await fetch(
    `/api/checkpoints?run=${encodeURIComponent(run)}`,
    { cache: 'no-store' }
  )
  return parseJson<CheckpointsResponse>(res)
}

export async function fetchSpeakers(run: string): Promise<SpeakersResponse> {
  const res = await fetch(
    `/api/speakers?run=${encodeURIComponent(run)}`,
    { cache: 'no-store' }
  )
  return parseJson<SpeakersResponse>(res)
}

export async function fetchInferenceConfig(): Promise<InferenceConfigBody> {
  const res = await fetch('/api/inference/config', { cache: 'no-store' })
  return parseJson<InferenceConfigBody>(res)
}

export async function postInference(
  body: InferenceRequestBody
): Promise<{ response: Response; data: InferenceResponse }> {
  const response = await fetch('/api/inference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson<InferenceResponse>(response)
  return { response, data }
}

export function getApiErrorMessage(
  data: ApiErrorBody | { error?: unknown }
): string {
  if (typeof data.error === 'string') return data.error
  if (
    data.error &&
    typeof data.error === 'object' &&
    'message' in data.error &&
    typeof (data.error as { message: string }).message === 'string'
  ) {
    return (data.error as { message: string }).message
  }
  return '요청 실패'
}
