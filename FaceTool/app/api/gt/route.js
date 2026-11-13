/**
 * ============================================================================
 * API Route: GT( Ground Truth ) 블렌드쉐이프 조회
 * ============================================================================
 *
 * GET /api/gt?name={clipName}&split={train|val|test}
 * GET /api/gt?name={clipName}&run={run}&folderPath=inference_debug
 *
 * - run + folderPath=inference_debug: 해당 run의 inference_debug 폴더에서
 *   {name}_gt.csv 또는 {name에서 _input_blendshape 제거}_gt.csv 찾아 CSV 내용 반환
 *   응답: { success, gtCsvContent, gtFileName } (없으면 404)
 * - 그 외: DatasetGen LipReading_Dataset_Video/{split}/{clipName}.npy 를 읽어 JSON 반환
 * ============================================================================
 */

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { clipNameForVideoLookup } from '../utils/clipNameForVideoLookup'
import { getBestFolderPath } from '../resultsConfig'

const DEFAULT_DATASET_DIR = 'E:\\DatasetGen'
const VIDEO_DATASET_DIR = path.join(DEFAULT_DATASET_DIR, 'LipReading_Dataset_Video')

// DatasetGen npy_to_csv.py와 동일한 51개 ARKit 블렌드쉐이프 이름
const BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
  'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen',
  'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft',
  'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower',
  'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft',
  'noseSneerRight'
]

/** 클립명이 안전한지 검사 (경로 조작 방지) */
function isSafeClipName(name) {
  if (!name || typeof name !== 'string') return false
  return /^[a-zA-Z0-9_.-]+$/.test(name.trim()) && !name.includes('..')
}

/** NPY 파일 경로 찾기: train/val/test 순으로 탐색 */
function findNpyPath(clipName, split, basePath) {
  const base = basePath || VIDEO_DATASET_DIR
  const splits = split ? [split] : ['train', 'val', 'test']
  for (const s of splits) {
    const npyPath = path.join(base, s, `${clipName}.npy`)
    if (fs.existsSync(npyPath)) return npyPath
  }
  return null
}

/** 원본 파일명(stem)으로 데이터셋 조회 시 D3/D4/D8 접두사 후보 시도 (예: RD_Radio1_000_00 → D3_RD_Radio1_000_00.npy) */
function findNpyPathWithPrefixes(stem, split, basePath) {
  if (/^(D[348])_/i.test(stem)) return null
  for (const prefix of ['D3_', 'D4_', 'D8_']) {
    const p = findNpyPath(prefix + stem, split, basePath)
    if (p) return p
  }
  return null
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isSafeRun(run) {
  return run && typeof run === 'string' && /^[a-zA-Z0-9_.-]+$/.test(run.trim()) && !run.includes('..')
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const run = searchParams.get('run') || ''
  const folderPath = searchParams.get('folderPath') || ''
  const split = searchParams.get('split') || ''
  const basePath = searchParams.get('basePath') || DEFAULT_DATASET_DIR

  if (!name || !isSafeClipName(name)) {
    return NextResponse.json({ success: false, error: 'name required or invalid' }, { status: 400 })
  }

  const clipName = name.trim()

  // inference_debug: run의 inference_debug 폴더에서 *_gt.csv 찾기
  if (folderPath === 'inference_debug' && isSafeRun(run)) {
    const debugDir = getBestFolderPath(run.trim(), 'inference_debug')
    if (!fs.existsSync(debugDir) || !fs.statSync(debugDir).isDirectory()) {
      return NextResponse.json({ success: false, error: 'inference_debug folder not found', run }, { status: 404 })
    }
    const baseName = clipName.replace(/\.(csv|npy)$/i, '')
    const baseNoInput = baseName.replace(/_input_blendshape$/, '').replace(/_input$/, '')
    const gtCandidates = [
      path.join(debugDir, `${baseName}_gt.csv`),
      path.join(debugDir, `${baseNoInput}_gt.csv`),
      ...(baseName.endsWith('_gt') ? [path.join(debugDir, `${baseName}.csv`)] : []),
      ...(baseName.endsWith('_input_blendshape') ? [path.join(debugDir, `${baseName.replace(/_input_blendshape$/, '')}_gt.csv`)] : []),
    ]
    for (const gtPath of gtCandidates) {
      if (fs.existsSync(gtPath)) {
        try {
          const gtCsvContent = fs.readFileSync(gtPath, 'utf8')
          const gtFileName = path.basename(gtPath)
          return NextResponse.json({ success: true, gtCsvContent, gtFileName })
        } catch (e) {
          console.warn('[api/gt] inference_debug GT read failed:', gtPath, e?.message)
        }
      }
    }
    return NextResponse.json({ success: false, error: 'GT csv not found in inference_debug', name: clipName }, { status: 404 })
  }

  // 데이터셋 NPY: _speakerN, _styleN 제거 후 조회; 원본 파일명(stem)이면 D3/D4/D8 접두사 후보도 시도
  const lookupName = clipNameForVideoLookup(clipName)
  const videoDir = path.join(basePath, 'LipReading_Dataset_Video')
  if (!fs.existsSync(videoDir)) {
    return NextResponse.json({
      success: false,
      error: 'LipReading_Dataset_Video not found',
      path: videoDir
    }, { status: 404 })
  }

  let npyPath = findNpyPath(lookupName, split, videoDir)
  if (!npyPath) npyPath = findNpyPathWithPrefixes(lookupName, split, videoDir)
  if (!npyPath) {
    return NextResponse.json({
      success: false,
      error: 'GT npy not found',
      clipName
    }, { status: 404 })
  }

  return new Promise((resolve) => {
    const py = spawn('python', [
      '-c',
      `import numpy as np; import json; d=np.load(r"${npyPath.replace(/\\/g, '\\\\')}"); print(json.dumps(d.tolist()))`
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''

    py.stdout.on('data', (chunk) => { stdout += chunk })
    py.stderr.on('data', (chunk) => { stderr += chunk })

    py.on('close', (code) => {
      if (code !== 0) {
        console.error('[api/gt] Python error:', stderr)
        return resolve(NextResponse.json({
          success: false,
          error: 'Failed to read npy',
          detail: stderr.slice(0, 200)
        }, { status: 500 }))
      }

      try {
        let data = JSON.parse(stdout)
        if (!Array.isArray(data)) data = []
        if (data.length && !Array.isArray(data[0])) data = [data]
        const fps = 30
        const frames = data.length

        resolve(NextResponse.json({
          success: true,
          blendshapes: BLENDSHAPE_NAMES,
          data,
          fps,
          frames,
          clipName
        }))
      } catch (e) {
        console.error('[api/gt] Parse error:', e.message)
        resolve(NextResponse.json({
          success: false,
          error: 'Invalid npy format',
          detail: e.message
        }, { status: 500 }))
      }
    })
  })
}
