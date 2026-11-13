/**
 * ============================================================================
 * API Route: 에폭 폴더 내 CSV/WAV 파일 목록 (FastAPI 프록시 또는 로컬 스캔)
 * ============================================================================
 *
 * GET /api/epoch/files?run=...&folderPath=...
 * - ENABLE_LOCAL_RESULTS 이면 run/blendshape_samples/{folderPath}/ 내 파일 스캔
 * - 아니면 FastAPI GET {BASE}/api/epoch/files
 *
 * 응답: files: [{ name, type: "csv"|"wav" }], wavFileName
 * ============================================================================
 */

import fs from 'fs'
import path from 'path'
import { EPOCH_API_BASE, ENABLE_LOCAL_RESULTS } from '../../backendConfig'
import { getBestFolderPath } from '../../resultsConfig'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const run = searchParams.get('run') || ''
    const folderPath = searchParams.get('folderPath') || ''

    if (!run || !folderPath) {
      return Response.json(
        { success: false, error: 'run and folderPath are required', files: [] },
        { status: 400 }
      )
    }

    if (ENABLE_LOCAL_RESULTS) {
      const dir = getBestFolderPath(run, folderPath)
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return Response.json(
          { success: false, files: [], error: 'Folder not found', folderPath },
          { status: 404 }
        )
      }
      const entries = fs.readdirSync(dir, { withFileTypes: false })
      const hasWav = new Set()
      const hasBlend = new Set()
      const allFiles = []
      let wavFileName = null
      for (const f of entries) {
        const ext = path.extname(f).toLowerCase()
        const base = path.basename(f, ext)
        if (ext === '.wav') {
          hasWav.add(base)
          allFiles.push({ name: f, type: 'wav' })
          if (!wavFileName) wavFileName = f
        }
        if (ext === '.csv' || ext === '.npy') {
          hasBlend.add(base)
          allFiles.push({ name: f, type: 'csv' })
        }
      }
      // inference_debug: WAV 없이 CSV만 있어도 포함
      const isInferenceDebug = folderPath === 'inference_debug'
      let files
      if (isInferenceDebug) {
        // inference_debug: 예측/입력 CSV만 클립으로 (GT용 *_gt.csv 제외), 각 항목에 원본 오디오 이름(sourceAudioFilename) 첨부
        const filtered = allFiles
          .filter(f => f.type === 'csv' && !path.basename(f.name, '.csv').endsWith('_gt'))
          .sort((a, b) => a.name.localeCompare(b.name))
        files = filtered.map((f) => {
          const base = path.basename(f.name, '.csv')
          const sourceTxtName = base.replace(/_input_blendshape$/, '').replace(/_input$/, '') + '_input_source.txt'
          const sourceTxtPath = path.join(dir, sourceTxtName)
          let sourceAudioFilename = null
          if (fs.existsSync(sourceTxtPath)) {
            try {
              const raw = fs.readFileSync(sourceTxtPath, 'utf8').trim()
              const firstLine = raw.split(/\r?\n/)[0]?.trim()
              if (firstLine) sourceAudioFilename = firstLine
            } catch {}
          }
          return { ...f, sourceAudioFilename: sourceAudioFilename || undefined }
        })
      } else {
        // 학습 결과: WAV+CSV/NPY 쌍만
        const clipBases = [...hasWav].filter(b => hasBlend.has(b)).sort()
        files = clipBases.map(base => ({ name: base, type: 'csv' }))
      }
      return Response.json({
        success: true,
        files,
        wavFileName,
        run,
        folderPath,
      })
    }

    const apiUrl = `${EPOCH_API_BASE}/api/epoch/files?run=${encodeURIComponent(run)}&folderPath=${encodeURIComponent(folderPath)}`
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      let errorData
      try {
        errorData = await res.json()
      } catch {
        errorData = { error: `HTTP ${res.status}` }
      }
      return Response.json(
        { success: false, files: [], error: errorData.detail || errorData.error || 'Failed to list epoch files' },
        { status: res.status }
      )
    }

    const data = await res.json()
    return Response.json({
      success: data.success !== false,
      files: data.files || [],
      wavFileName: data.wavFileName,
      run,
      folderPath,
    })
  } catch (error) {
    console.error('[API/epoch/files] Error:', error)
    return Response.json(
      { success: false, files: [], error: error.message },
      { status: 500 }
    )
  }
}
