/**
 * FaceTool ↔ Next BFF ↔ FastAPI 공용 API 계약.
 * @see docs/FRONT_BACKEND_CONTRACT.md
 */

/** 프레임당 blendshape 값 (frame/time_sec + 채널) */
export type BlendshapeFrame = Record<string, number> & {
  frame?: number
  time_sec?: number
}

export interface ApiErrorBody {
  success: false
  error: string
}

export interface RunEntry {
  id: string
  label?: string
  output_kind?: 'arkit_51' | 'metahuman_260'
  strategy?: string
  path?: string
  epochCount?: number
  hasBlendshapeSamples?: boolean
}

export interface RunsSuccessBody {
  success: true
  runs: (string | RunEntry)[]
  baseDir?: string
  error: null
}

export type RunsResponse = RunsSuccessBody | ApiErrorBody

export interface CheckpointsSuccessBody {
  success: true
  checkpoints: string[]
}

export type CheckpointsResponse = CheckpointsSuccessBody | ApiErrorBody

export interface SpeakersSuccessBody {
  success: true
  speakers: number[] | Record<string, unknown>
}

export type SpeakersResponse = SpeakersSuccessBody | ApiErrorBody

export interface InferenceConfigBody {
  localOnnx: boolean
  onnxModelPath: string | null
  onnxModelExists: boolean
  backendUrl: string
  proxyToBackendWhenRunSet: boolean
}

/** POST /api/inference 요청 (브라우저 → BFF) */
export interface InferenceRequestBody {
  audio_base64?: string
  audio?: string
  run?: string
  checkpoint?: string
  speaker?: number
  enable_eye_blink?: boolean
  source_audio_filename?: string
  compare_vanilla?: boolean
}

/** POST /api/inference 성공 응답 (정규화 후) */
export interface InferenceSuccessBody {
  success: true
  blendshapes: string[]
  blendshapes_glb?: string[]
  data: BlendshapeFrame[]
  fps: number
  frames: number
  output_kind?: 'arkit_51' | 'metahuman_260'
  channels?: number
  csvContent: string | null
  audioBase64: string | null
  source: 'backend' | 'local_onnx' | string
}

export type InferenceResponse = InferenceSuccessBody | ApiErrorBody

/** FastAPI / 로컬 ONNX 원시 응답 (필드명 변형 허용) */
export interface RawInferencePayload {
  success?: boolean
  error?: string
  blendshapes?: string[]
  blendshapes_glb?: string[]
  blend_shapes?: string[]
  morph_targets?: string[]
  blendshape_names?: string[]
  data?: BlendshapeFrame[]
  predictions?: BlendshapeFrame[]
  output?: BlendshapeFrame[]
  /** 프레임 수(숫자) 또는 레거시 배열 필드 */
  frames?: number | BlendshapeFrame[]
  result?: BlendshapeFrame[]
  fps?: number
  output_kind?: 'arkit_51' | 'metahuman_260'
  channels?: number
  csvContent?: string | null
  audioBase64?: string | null
  source?: string
}

export function isApiError(
  body: { success?: boolean }
): body is ApiErrorBody {
  return body.success === false
}
