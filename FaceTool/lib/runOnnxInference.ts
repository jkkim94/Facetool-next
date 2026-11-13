/**
 * 로컬 UniTalker ONNX 추론 (Python subprocess)
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getOnnxModelPath } from '@/app/api/backendConfig'
import type { RawInferencePayload } from '@/types/api'

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'onnx_inference.py')

function resolvePythonExecutable(): string {
  if (process.env.ONNX_PYTHON) return process.env.ONNX_PYTHON
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH
  return process.platform === 'win32' ? 'python' : 'python3'
}

export interface RunOnnxInferenceParams {
  audioBase64: string
  modelPath?: string | null
}

export function runOnnxInference({
  audioBase64,
  modelPath,
}: RunOnnxInferenceParams): Promise<RawInferencePayload> {
  const model = modelPath?.trim() || getOnnxModelPath()
  if (!model) {
    return Promise.reject(
      new Error(
        'ONNX_MODEL_PATH가 설정되지 않았습니다. .env.local에 유효한 .onnx 경로를 지정하세요.'
      )
    )
  }

  if (!fs.existsSync(SCRIPT_PATH)) {
    return Promise.reject(
      new Error(`ONNX 추론 스크립트가 없습니다: ${SCRIPT_PATH}`)
    )
  }
  if (!fs.existsSync(model)) {
    return Promise.reject(new Error(`ONNX 모델 파일이 없습니다: ${model}`))
  }

  const python = resolvePythonExecutable()
  const payload = JSON.stringify({
    audio_base64: audioBase64,
    model_path: model,
  })

  return new Promise((resolve, reject) => {
    const child = spawn(python, [SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ONNX_MODEL_PATH: model,
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err: Error) => {
      reject(
        new Error(
          `Python 실행 실패 (${python}). ONNX_PYTHON 환경변수를 확인하세요. ${err.message}`
        )
      )
    })

    child.on('close', (code: number | null) => {
      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(
          new Error(
            `ONNX 추론 스크립트 출력 없음 (exit ${code}). ${stderr || 'stderr 비어 있음'}`
          )
        )
        return
      }

      try {
        const lastLine = trimmed.includes('\n')
          ? trimmed.split('\n').filter(Boolean).pop()!
          : trimmed
        const data = JSON.parse(lastLine) as RawInferencePayload
        if (!data.success) {
          reject(new Error(data.error || 'ONNX 추론 실패'))
          return
        }
        resolve(data)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        reject(
          new Error(
            `ONNX 응답 JSON 파싱 실패: ${message}. stdout=${trimmed.slice(0, 200)}`
          )
        )
      }
    })

    child.stdin.write(payload)
    child.stdin.end()
  })
}

export function isLocalOnnxEnabled(): boolean {
  const v = process.env.ENABLE_LOCAL_ONNX?.trim().toLowerCase()
  return v === '1' || v === 'true'
}
