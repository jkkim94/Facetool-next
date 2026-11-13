/**
 * 로컬 CSV 파일 -> DatasetViewer / ModelViewer용 블렌드셰이프 데이터
 * 지원: frame, time_sec + ARKit 51 (학습/GT) 또는 Frame + 블렌드셰이프 (추출기 출력)
 */

import { validateBlendshapeCsvHeader } from './blendshapeCsvValidation'
import { estimateTimelineMeta } from './csvTimeline'

function normHeader(h) {
  return (h && String(h).trim()).replace(/^\uFEFF/, '')
}

function isMetaColumn(name) {
  const n = normHeader(name).toLowerCase()
  return n === 'frame' || n === 'time_sec' || n === 'time'
}

/**
 * @param {string} text - CSV 본문
 * @param {{ strict?: boolean }} options
 * @returns {{
 *   frames: object[],
 *   blendshapeNames: string[],
 *   totalFrames: number,
 *   timeSec: number[],
 *   duration: number,
 *   detectedFps: number,
 *   hasTimeSec: boolean,
 * }}
 */
export function parseLocalBlendshapeCsv(text, options = {}) {
  const { strict = false } = options
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2) {
    throw new Error('CSV에 데이터가 부족합니다 (헤더 + 최소 1줄 필요).')
  }

  const header = lines[0].split(',').map(normHeader)
  if (header.length < 2) {
    throw new Error('CSV 헤더가 올바르지 않습니다.')
  }

  const hasFrame = header.some((h) => h.toLowerCase() === 'frame')
  if (!hasFrame) {
    throw new Error('frame 컬럼이 필요합니다.')
  }

  if (strict) {
    const validation = validateBlendshapeCsvHeader(header)
    if (!validation.valid) throw new Error(validation.error)
  }

  const frameIdx = header.findIndex((h) => h.toLowerCase() === 'frame')
  const timeSecIdx = header.findIndex((h) => {
    const n = h.toLowerCase()
    return n === 'time_sec' || n === 'time'
  })

  const blendshapeNames = header.filter((h) => h && !isMetaColumn(h))
  if (blendshapeNames.length === 0) {
    throw new Error('블렌드셰이프 컬럼을 찾을 수 없습니다.')
  }

  const frames = []
  const timeSec = []

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const cols = lines[rowIndex].split(',').map((c) => c.trim())
    if (cols.length < 2) continue

    const frameNum = parseInt(cols[frameIdx >= 0 ? frameIdx : 0], 10) || rowIndex - 1
    const row = { frame: frameNum }

    if (timeSecIdx >= 0) {
      const t = parseFloat(cols[timeSecIdx])
      row.time_sec = Number.isFinite(t) ? t : (rowIndex - 1) / 30
      timeSec.push(row.time_sec)
    }

    for (const name of blendshapeNames) {
      const colIdx = header.indexOf(name)
      const v = colIdx >= 0 ? parseFloat(cols[colIdx]) : 0
      row[name] = Number.isFinite(v) ? v : 0
    }
    frames.push(row)
  }

  if (!frames.length) {
    throw new Error('CSV 파일에 유효한 데이터 행이 없습니다.')
  }

  // time_sec 없으면 frame/fps 가정으로 생성
  if (timeSec.length === 0) {
    for (let i = 0; i < frames.length; i++) {
      const t = i / 30
      frames[i].time_sec = t
      timeSec.push(t)
    }
  }

  const meta = estimateTimelineMeta(timeSec)

  return {
    frames,
    blendshapeNames,
    totalFrames: frames.length,
    timeSec,
    duration: meta.duration,
    detectedFps: meta.detectedFps,
    hasTimeSec: timeSecIdx >= 0,
  }
}
