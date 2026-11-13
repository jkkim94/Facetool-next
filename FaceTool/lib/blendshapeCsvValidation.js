/**
 * 블렌드쉐입 CSV 형식 검증
 * - 학습 결과/추론/GT에서 사용하는 CSV는 frame, time_sec + ARKit 51개 블렌드쉐입 컬럼 형식이어야 함
 * - 형식이 다르면 파서는 통과해도 3D 뷰어에서 얼굴이 안 움직이는 등 오동작 가능
 */

/** 백엔드/뷰어에서 기대하는 ARKit 블렌드쉐입 이름 51개 (순서 무관, 헤더에 이 이름들이 있어야 함) */
export const EXPECTED_BLENDSHAPE_NAMES = [
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

const REQUIRED_HEADER = ['frame', 'time_sec']
const EXPECTED_SET = new Set(EXPECTED_BLENDSHAPE_NAMES)
/** 헤더에 최소 이만큼의 기대 블렌드쉐입 이름이 있어야 "올바른 형식"으로 인정 */
const MIN_MATCHING_BLENDSHAPES = 45

/**
 * CSV 헤더(컬럼 이름 배열)가 지원 형식인지 검사
 * @param {string[]} header - 첫 줄을 split(',')한 뒤 trim한 배열
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateBlendshapeCsvHeader(header) {
  if (!Array.isArray(header) || header.length === 0) {
    return { valid: false, error: '헤더가 비어 있거나 올바르지 않습니다.' }
  }

  const trimmed = header.map(h => (h && String(h).trim()).replace(/^\uFEFF/, '')) // BOM 제거
  const hasFrame = trimmed.some(h => h === 'frame')
  const hasTimeSec = trimmed.some(h => h === 'time_sec')

  if (!hasFrame || !hasTimeSec) {
    const missing = []
    if (!hasFrame) missing.push('frame')
    if (!hasTimeSec) missing.push('time_sec')
    return {
      valid: false,
      error: `지원하지 않는 CSV 형식입니다. 필수 컬럼이 없습니다: ${missing.join(', ')}. (필수: frame, time_sec + ARKit 블렌드쉐입 51개)`
    }
  }

  const blendshapeHeaders = trimmed.filter(h => h !== 'frame' && h !== 'time_sec')
  const matching = blendshapeHeaders.filter(h => EXPECTED_SET.has(h))
  if (matching.length < MIN_MATCHING_BLENDSHAPES) {
    return {
      valid: false,
      error: `지원하지 않는 CSV 형식입니다. ARKit 블렌드쉐입 컬럼이 부족합니다 (발견: ${matching.length}개, 필요: 최소 ${MIN_MATCHING_BLENDSHAPES}개). frame, time_sec 및 51개 ARKit 블렌드쉐입 컬럼이 있어야 합니다.`
    }
  }

  return { valid: true }
}
