/**
 * ============================================================================
 * API Route: 에폭/클립 학습 결과 로드
 * ============================================================================
 *
 * 새 구조 (ENABLE_LOCAL_RESULTS=1):
 *   Body: { run, clipBaseName } → run/blendshape_samples/best/{clipBaseName}.csv 또는 .npy + .wav
 *   inference_debug: { run, folderPath: "inference_debug", csvFileName } → run/inference_debug/{csvFileName}
 * 기존 구조: Body: { folderPath, run } → FastAPI /api/epoch 프록시
 * ============================================================================
 */

import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import {
  getBestFolderPath,
  getBlendshapeFilePath,
  getWavFilePath,
  BLENDSHAPE_NAMES_FOR_NPY,
} from '../../resultsConfig'
import { validateBlendshapeCsvHeader } from '@/lib/blendshapeCsvValidation'
import { EPOCH_API_BASE, ENABLE_LOCAL_RESULTS } from '../../backendConfig'

const USE_LOCAL = ENABLE_LOCAL_RESULTS

function isSafeName(name) {
  if (!name || typeof name !== 'string') return false
  const t = name.trim()
  return t.length > 0 && /^[a-zA-Z0-9_.-]+$/.test(t) && !t.includes('..')
}

/** NPY 파일을 Python으로 읽어 CSV 문자열로 반환 */
function npyToCsvString(npyPath) {
  return new Promise((resolve, reject) => {
    const escaped = npyPath.replace(/\\/g, '\\\\')
    const py = spawn('python', [
      '-c',
      `import numpy as np; import json; d=np.load(r"${escaped}"); print(json.dumps(d.tolist()))`
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    py.stdout.on('data', (chunk) => { stdout += chunk })
    py.stderr.on('data', (chunk) => { stderr += chunk })
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || 'Python failed'))
      try {
        const data = JSON.parse(stdout)
        const rows = Array.isArray(data) ? (Array.isArray(data[0]) ? data : [data]) : []
        const header = BLENDSHAPE_NAMES_FOR_NPY.join(',')
        const lines = [header, ...rows.map((row) => (Array.isArray(row) ? row : []).map((v) => Number(v)).join(','))]
        resolve(lines.join('\n'))
      } catch (e) {
        reject(e)
      }
    })
  })
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request) {
  try {
    const body = await request.json()
    const { folderPath, run, clipBaseName, csvFileName: csvFileNameParam } = body || {}

    // 로컬 모드: "best/clip1" 형식 또는 folderPath + csvFileName (예: best, clip1.csv)
    const localClipName = clipBaseName || (USE_LOCAL && folderPath ? folderPath : null)
    const hasLocal = USE_LOCAL && run && (localClipName || (folderPath && csvFileNameParam))
    if (hasLocal) {
      let subFolder = 'best'
      let clipBase
      if (csvFileNameParam) {
        clipBase = csvFileNameParam.replace(/\.csv$/i, '').replace(/\.npy$/i, '').trim()
        if (folderPath && !String(folderPath).includes('/')) subFolder = String(folderPath).trim()
      } else {
        clipBase = localClipName.trim()
        if (clipBase.includes('/')) {
          const parts = clipBase.split('/')
          subFolder = parts[0]
          clipBase = parts.slice(1).join('/')
        }
      }
      if (!isSafeName(run) || !isSafeName(subFolder) || !isSafeName(clipBase)) {
        return new Response(
          JSON.stringify({ success: false, error: 'run and clipBaseName required and must be safe' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      let bestPath = getBestFolderPath(run, subFolder)
      if (!fs.existsSync(bestPath) && subFolder !== 'best') {
        const fallbackPath = getBestFolderPath(run, 'best')
        if (fs.existsSync(fallbackPath) && getBlendshapeFilePath(fallbackPath, clipBase) && getWavFilePath(fallbackPath, clipBase)) {
          bestPath = fallbackPath
        }
      }
      if (!fs.existsSync(bestPath)) {
        return new Response(
          JSON.stringify({ success: false, error: `Folder not found: ${subFolder}`, path: bestPath }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const blendFile = getBlendshapeFilePath(bestPath, clipBase)
      const wavPath = getWavFilePath(bestPath, clipBase)
      const isInferenceDebug = subFolder === 'inference_debug'

      // inference_debug: WAV 없어도 CSV만 있으면 로드 가능
      if (!blendFile || (!wavPath && !isInferenceDebug)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: isInferenceDebug ? 'csv not found in inference_debug' : 'csv/npy or wav not found',
            clipBaseName: clipBase,
            hasBlend: !!blendFile,
            hasWav: !!wavPath,
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      let csvContent = ''
      if (blendFile.type === 'csv') {
        csvContent = fs.readFileSync(blendFile.path, 'utf8')
        const firstLine = csvContent.split(/\r?\n/)[0]
        if (firstLine) {
          const header = firstLine.split(',').map(h => h.trim()).filter(h => h.length > 0)
          const validation = validateBlendshapeCsvHeader(header)
          if (!validation.valid) {
            return new Response(
              JSON.stringify({ success: false, error: validation.error, csvFormatError: true }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }
      } else {
        csvContent = await npyToCsvString(blendFile.path)
      }

      let audioBase64 = null
      let audioFileName = null
      if (wavPath) {
        const wavBuffer = fs.readFileSync(wavPath)
        audioBase64 = wavBuffer.toString('base64')
        audioFileName = `${clipBase}.wav`
      }
      const csvFileName = blendFile.type === 'csv' ? `${clipBase}.csv` : `${clipBase}.npy`

      // inference_debug: 같은 폴더에서 *_gt.csv 후보 탐색. 백엔드 명명: xxx_s0_gt.csv 등
      let gtCsvContent = null
      let gtCsvFileName = null
      let source_audio_filename = null
      if (isInferenceDebug && bestPath) {
        const baseNoInput = clipBase.replace(/_input_blendshape$/, '').replace(/_input$/, '')
        const gtCandidates = [
          path.join(bestPath, `${clipBase}_gt.csv`),
          path.join(bestPath, `${baseNoInput}_gt.csv`),
          ...(clipBase.endsWith('_input_blendshape')
            ? [path.join(bestPath, `${clipBase.replace(/_input_blendshape$/, '')}_gt.csv`)]
            : []),
        ]
        for (const gtPath of gtCandidates) {
          if (fs.existsSync(gtPath)) {
            try {
              gtCsvContent = fs.readFileSync(gtPath, 'utf8')
              gtCsvFileName = path.basename(gtPath)
              break
            } catch (e) {
              console.warn('[epoch/load] GT CSV read failed:', gtPath, e?.message)
            }
          }
        }
        // 추론 시 우리가 보낸 source_audio_filename이 백엔드에 저장된 _input_source.txt에서 읽힘. 경로면 파일명만 사용
        const sourceTxtPath = clipBase.endsWith('_input_blendshape')
          ? path.join(bestPath, `${clipBase.replace(/_input_blendshape$/, '')}_input_source.txt`)
          : path.join(bestPath, `${clipBase}_input_source.txt`)
        if (fs.existsSync(sourceTxtPath)) {
          try {
            const raw = fs.readFileSync(sourceTxtPath, 'utf8').trim()
            let firstLine = raw.split(/\r?\n/)[0]?.trim()
            if (firstLine) {
              if (firstLine.includes('/') || firstLine.includes('\\')) {
                firstLine = path.basename(firstLine)
              }
              source_audio_filename = firstLine
            }
          } catch (e) {
            console.warn('[epoch/load] _input_source.txt read failed:', sourceTxtPath, e?.message)
          }
        }
      }

      return Response.json({
        success: true,
        csvContent,
        audioBase64,
        audioFileName,
        csvFileName,
        folderName: `${subFolder}/${clipBase}`,
        gtCsvContent,
        gtCsvFileName,
        source_audio_filename: source_audio_filename || undefined,
        lve: null,
        lvd: null,
        valLve: null,
        valLvd: null,
      })
    }

    if (!folderPath) {
      return new Response(
        JSON.stringify({ success: false, error: 'folderPath or (run + clipBaseName) required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const requestBody = { folderPath }
    if (run) requestBody.run = run
    if (csvFileNameParam) requestBody.csvFileName = csvFileNameParam

    const res = await fetch(`${EPOCH_API_BASE}/api/epoch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      let errorData
      try {
        const text = await res.text()
        errorData = JSON.parse(text)
      } catch {
        errorData = { error: res.statusText || `HTTP ${res.status} Error` }
      }
      return new Response(
        JSON.stringify({ success: false, error: errorData.detail || errorData.error || 'Failed to load epoch folder' }),
        { status: res.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await res.json()
    return Response.json({
      success: data.success,
      csvContent: data.csvContent,
      audioBase64: data.audioBase64,
      audioFileName: data.audioFileName,
      csvFileName: data.csvFileName,
      folderName: data.folderName,
      gtCsvContent: data.gtCsvContent,
      gtCsvFileName: data.gtFileName || data.gtCsvFileName,
      lve: data.lve,
      lvd: data.lvd,
      valLve: data.valLve,
      valLvd: data.valLvd,
    })
  } catch (error) {
    console.error('[API Route/epoch/load] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
