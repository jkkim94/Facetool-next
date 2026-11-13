/** run id → 로컬 GT 데이터셋 기본 경로 */
import {
  isArkitRun,
  isMetaHumanRun,
} from '@/lib/inference/outputKind'

export const GT_PATH_METAHUMAN = 'E:\\DatasetGen\\D8_metahuman_control'
export const GT_PATH_ARKIT = 'E:\\DatasetGen\\LipReading_Dataset_Video'

export function gtBasePathForRun(runId) {
  if (isMetaHumanRun(runId)) return GT_PATH_METAHUMAN
  if (isArkitRun(runId)) return GT_PATH_ARKIT
  return GT_PATH_METAHUMAN
}

export function inferKindFromChannelCount(n) {
  if (n === 260 || n === 280) return 'metahuman_260'
  if (n === 51 || n === 52) return 'arkit_51'
  return null
}

/** /api/file npy JSON → DualFaceViewer / RigLogic 공통 포맷 */
export function npyJsonToTrainingData(json, serviceName = 'gt') {
  const names = json.blendshapeNames || json.featureNames || []
  const frames = json.frames || []
  const fps = json.fps || 30

  if (frames.length && typeof frames[0] === 'object' && !Array.isArray(frames[0])) {
    const blendshapes = names.length ? names : Object.keys(frames[0]).filter((k) => k !== 'frame')
    const data = frames.map((row) => blendshapes.map((n) => Number(row[n]) || 0))
    const kind =
      json.outputKind ||
      inferKindFromChannelCount(blendshapes.length)
    return {
      service: serviceName,
      fps,
      frames: data.length,
      duration: data.length / fps,
      blendshapes,
      data,
      outputKind: kind,
    }
  }

  const rows = json.data || json.values
  if (Array.isArray(rows) && rows.length && Array.isArray(rows[0])) {
    const kind =
      json.outputKind ||
      inferKindFromChannelCount(names.length)
    return {
      service: serviceName,
      fps,
      frames: rows.length,
      duration: rows.length / fps,
      blendshapes: names,
      data: rows.map((r) => r.map((v) => Number(v) || 0)),
      outputKind: kind,
    }
  }

  throw new Error('NPY JSON 형식을 인식할 수 없습니다')
}

/** inference API 응답 → training data 포맷 */
export function inferenceToTrainingData(res, serviceName = 'pred') {
  const blendshapes = res.blendshapes || []
  const raw = res.data || []
  const fps = res.fps || 30
  const data = raw.map((row) =>
    Array.isArray(row)
      ? row.map((v) => Number(v) || 0)
      : blendshapes.map((n) => Number(row[n]) || 0),
  )
  const kind =
    res.output_kind ||
    inferKindFromChannelCount(res.channels ?? blendshapes.length)
  return {
    service: serviceName,
    fps,
    frames: data.length,
    duration: data.length / fps,
    blendshapes,
    data,
    outputKind: kind,
  }
}
