/**
 * 결과 폴더(Results) 구조 설정
 * - 학습 구조: results_XXX/blendshape_samples/best/ 아래에 CSV+WAV 또는 NPY+WAV 쌍
 * - 추론 구조: results_XXX/inference_debug/ 아래에 CSV+WAV 쌍 (서비스 추론 결과)
 */

import path from 'path'
import fs from 'fs'

import { resultsBasePath } from './vendorPaths'

export const RESULTS_BASE_PATH = resultsBasePath()
export const BLENDSHAPE_SAMPLES_RELATIVE = 'blendshape_samples'
export const BEST_FOLDER_RELATIVE = 'blendshape_samples/best'
export const INFERENCE_DEBUG_FOLDER = 'inference_debug'

/** Run 폴더 전체 경로 */
export function getRunPath(runName) {
  return path.join(RESULTS_BASE_PATH, runName)
}

/** inference_debug 폴더인지 확인 */
export function isInferenceDebugFolder(folderName) {
  return folderName === INFERENCE_DEBUG_FOLDER
}

/**
 * 서브폴더 전체 경로 반환
 * - inference_debug: run 루트 아래 (blendshape_samples가 아닌 run/inference_debug/)
 * - 나머지 (best, best1, epoch_* 등): run/blendshape_samples/{subFolder}/
 */
export function getBestFolderPath(runName, subFolder = 'best') {
  if (isInferenceDebugFolder(subFolder)) {
    return path.join(RESULTS_BASE_PATH, runName, INFERENCE_DEBUG_FOLDER)
  }
  return path.join(RESULTS_BASE_PATH, runName, BLENDSHAPE_SAMPLES_RELATIVE, subFolder)
}

/** run 폴더(루트)에 .pt 파일이 1개 이상 있는지 확인 (학습 모델 체크포인트) */
export function hasPtInRun(runName) {
  const runPath = path.join(RESULTS_BASE_PATH, runName)
  if (!fs.existsSync(runPath) || !fs.statSync(runPath).isDirectory()) return false
  const files = fs.readdirSync(runPath)
  return files.some((f) => f.toLowerCase().endsWith('.pt'))
}

/** run 폴더(및 checkpoints/)에서 .pt 체크포인트 목록 — best.pt 우선 */
export function listCheckpointsFromDisk(runName) {
  const runPath = getRunPath(runName)
  const found = new Set()

  const scanDir = (dir) => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.pt')) found.add(f)
    }
  }

  scanDir(runPath)
  scanDir(path.join(runPath, 'checkpoints'))

  const list = [...found].sort((a, b) => {
    const aBest = /^best/i.test(a)
    const bBest = /^best/i.test(b)
    if (aBest && !bBest) return -1
    if (!aBest && bBest) return 1
    return a.localeCompare(b, undefined, { numeric: true })
  })

  return list.length ? list : ['best.pt']
}

function tryReadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch {
    // ignore
  }
  return null
}

/** run 설정 파일 또는 기본값으로 화자 목록 */
export function listSpeakersFromDisk(runName) {
  const runPath = getRunPath(runName)
  const configNames = ['config.json', 'hparams.json', 'args.json', 'run_config.json']

  for (const name of configNames) {
    const cfg = tryReadJson(path.join(runPath, name))
    if (!cfg || typeof cfg !== 'object') continue

    const names = cfg.speaker_names ?? cfg.speakers ?? cfg.identity_names
    if (Array.isArray(names) && names.length > 0) {
      return {
        count: names.length,
        names: names.map(String),
        indices: names.map((_, i) => i),
      }
    }

    const count =
      cfg.num_speakers ??
      cfg.n_speakers ??
      cfg.num_speaker ??
      cfg.speaker_count
    if (typeof count === 'number' && count > 0) {
      return {
        count,
        names: Array.from({ length: count }, (_, i) => `Speaker ${i}`),
        indices: Array.from({ length: count }, (_, i) => i),
      }
    }
  }

  return { count: 1, names: ['Speaker 0'], indices: [0] }
}

/** API speakers 필드 정규화 */
export function normalizeSpeakers(raw) {
  if (Array.isArray(raw)) {
    return {
      count: raw.length,
      names: raw.map(String),
      indices: raw.map((_, i) => i),
    }
  }
  if (raw && typeof raw === 'object') {
    const count = raw.count ?? raw.num_speakers ?? raw.n_speakers ?? 1
    const names = raw.names ?? raw.speaker_names
    if (Array.isArray(names) && names.length > 0) {
      return {
        count: names.length,
        names: names.map(String),
        indices: raw.indices ?? names.map((_, i) => i),
      }
    }
    const n = Math.max(1, Number(count) || 1)
    return {
      count: n,
      names: Array.from({ length: n }, (_, i) => `Speaker ${i}`),
      indices: Array.from({ length: n }, (_, i) => i),
    }
  }
  return { count: 1, names: ['Speaker 0'], indices: [0] }
}

/**
 * Run 목록 스캔: results, results_* 접두사 매칭
 * 포함 조건: (1) blendshape_samples 폴더 존재, (2) inference_debug 폴더에 CSV 1개 이상, (3) run 폴더에 .pt 1개 이상
 */
export function listRunsFromDisk() {
  if (!fs.existsSync(RESULTS_BASE_PATH)) return []
  const entries = fs.readdirSync(RESULTS_BASE_PATH, { withFileTypes: true })
  return entries
    .filter((e) => {
      if (!e.isDirectory()) return false
      const name = e.name.toLowerCase()
      if (name !== 'results' && !name.startsWith('results_')) return false
      const runPath = path.join(RESULTS_BASE_PATH, e.name)
      // (1) blendshape_samples 폴더 존재
      const bsPath = path.join(runPath, BLENDSHAPE_SAMPLES_RELATIVE)
      if (fs.existsSync(bsPath) && fs.statSync(bsPath).isDirectory()) return true
      // (2) inference_debug 폴더 존재하고 CSV 1개 이상
      if (hasInferenceDebugCsv(e.name)) return true
      // (3) run 폴더에 .pt 파일 1개 이상 (학습 모델만 있는 경우도 조회 가능)
      if (hasPtInRun(e.name)) return true
      return false
    })
    .map((e) => e.name)
}

/** run/inference_debug/ 에 CSV가 1개 이상 있는지 확인 */
export function hasInferenceDebugCsv(runName) {
  const debugPath = path.join(RESULTS_BASE_PATH, runName, INFERENCE_DEBUG_FOLDER)
  if (!fs.existsSync(debugPath) || !fs.statSync(debugPath).isDirectory()) return false
  const files = fs.readdirSync(debugPath)
  return files.some((f) => f.toLowerCase().endsWith('.csv'))
}

/** blendshape_samples 안의 서브폴더 이름 목록 (best, best1, epoch_* 등) */
export function listBestLikeFolders(runName) {
  const samplesPath = path.join(RESULTS_BASE_PATH, runName, BLENDSHAPE_SAMPLES_RELATIVE)
  if (!fs.existsSync(samplesPath)) return []
  const entries = fs.readdirSync(samplesPath, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

/**
 * blendshape_samples + inference_debug 모두를 포함한 폴더 이름 목록
 * - blendshape_samples 서브폴더들 (best, best1, epoch_* 등)
 * - inference_debug (CSV 1개 이상 있을 때)
 */
export function listAllEpochFolders(runName) {
  const folders = listBestLikeFolders(runName)
  if (hasInferenceDebugCsv(runName)) {
    folders.push(INFERENCE_DEBUG_FOLDER)
  }
  return folders
}

/**
 * 한 폴더 내에서 클립 기준명 반환.
 * - requireWav=true: WAV + CSV/NPY 둘 다 있는 기준명만 (학습 결과)
 * - requireWav=false: CSV/NPY만 있어도 포함 (inference_debug 등)
 */
function listClipsInFolder(folderPath, requireWav = true) {
  if (!fs.existsSync(folderPath)) return []
  const files = fs.readdirSync(folderPath)
  const hasWav = new Set()
  const hasBlend = new Set()
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    const base = path.basename(f, ext)
    if (ext === '.wav') hasWav.add(base)
    if (ext === '.csv' || ext === '.npy') hasBlend.add(base)
  }
  if (requireWav) {
    return [...hasWav].filter((b) => hasBlend.has(b)).sort()
  }
  // WAV 불필요 (inference_debug 등): CSV/NPY 중 GT용 *_gt 제외
  return [...hasBlend].filter((b) => !b.endsWith('_gt')).sort()
}

/**
 * best, best1, inference_debug 등 모든 서브폴더를 스캔해 클립 목록 반환.
 * 반환 형식: ['best/clip1', 'best/clip2', 'best1/clip1', 'inference_debug/clip1', ...] (폴더명/클립기준명)
 */
export function listClipsInBestFolder(runName) {
  const subFolders = listAllEpochFolders(runName)
  const result = []
  for (const sub of subFolders) {
    const folderPath = getBestFolderPath(runName, sub)
    // inference_debug: WAV 없이 CSV만 있어도 포함
    const requireWav = !isInferenceDebugFolder(sub)
    const clips = listClipsInFolder(folderPath, requireWav)
    for (const clip of clips) {
      result.push(`${sub}/${clip}`)
    }
  }
  return result.sort()
}

/** 클립에 해당하는 CSV 또는 NPY 경로 (우선 CSV) */
export function getBlendshapeFilePath(bestPath, clipBaseName) {
  const csvPath = path.join(bestPath, `${clipBaseName}.csv`)
  const npyPath = path.join(bestPath, `${clipBaseName}.npy`)
  if (fs.existsSync(csvPath)) return { path: csvPath, type: 'csv' }
  if (fs.existsSync(npyPath)) return { path: npyPath, type: 'npy' }
  return null
}

export function getWavFilePath(bestPath, clipBaseName) {
  const wavPath = path.join(bestPath, `${clipBaseName}.wav`)
  return fs.existsSync(wavPath) ? wavPath : null
}

/** NPY 블렌드쉐이프 → CSV 문자열 (DatasetGen 51 ARKit 이름) */
export const BLENDSHAPE_NAMES_FOR_NPY = [
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
