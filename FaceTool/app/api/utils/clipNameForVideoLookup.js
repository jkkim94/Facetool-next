/**
 * 학습 결과 클립명에서 비디오/프레임/GT 조회용 base 이름을 반환합니다.
 * _speaker0, _speaker1, _style0 ~ _styleN 등은 비디오 검색과 무관하므로 제거합니다.
 *
 * 예:
 *   LipReading_lip_J_1_F_02_E209_A_010_003_speaker0 → LipReading_lip_J_1_F_02_E209_A_010_003
 *   LipReading_lip_J_1_F_02_E209_A_010_003_style2   → LipReading_lip_J_1_F_02_E209_A_010_003
 */

const TRAILING_SUFFIX = /_(?:speaker|style)\d+$/i

/**
 * @param {string} clipName - 클립 파일명(확장자 제외) 또는 표시용 이름
 * @returns {string} - MP4/프레임 폴더/GT npy 조회에 쓸 이름
 */
export function clipNameForVideoLookup(clipName) {
  if (!clipName || typeof clipName !== 'string') return clipName || ''
  const trimmed = clipName.trim()
  return trimmed.replace(TRAILING_SUFFIX, '')
}
