/**
 * GET /api/inference/config — 추론 모드(로컬 ONNX / FastAPI) 확인
 */

import fs from 'fs'

import {
  EPOCH_API_BASE,
  ENABLE_LOCAL_ONNX,
  getOnnxModelPath,
} from '../../backendConfig'
import type { InferenceConfigBody } from '@/types/api'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const onnxModelPath = getOnnxModelPath()
  const body: InferenceConfigBody = {
    localOnnx: ENABLE_LOCAL_ONNX,
    onnxModelPath,
    onnxModelExists: onnxModelPath ? fs.existsSync(onnxModelPath) : false,
    backendUrl: EPOCH_API_BASE,
    proxyToBackendWhenRunSet: true,
  }
  return Response.json(body)
}
