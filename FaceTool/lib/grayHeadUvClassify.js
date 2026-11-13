/** T_Gray_Head_D red lip stroke only (matches riglogic_py/gray_head_uv.py). */

const LIP_STROKE_REFS = [
  [242, 38, 51],
  [212, 103, 103],
  [216, 104, 103],
  [217, 104, 103],
  [211, 102, 103],
  [210, 102, 103],
  [209, 102, 103],
  [208, 102, 103],
  [189, 97, 102],
  [192, 97, 102],
  [187, 96, 102],
]
const LIP_STROKE_TOL = 28
const LIP_STROKE_MIN_R = 175
const LIP_STROKE_MAX_G = 115
const LIP_STROKE_MAX_B = 115
const LIP_STROKE_MIN_RG_DELTA = 35
const LIP_STROKE_MIN_RB_DELTA = 35

const SKIN = { r: 0.78, g: 0.62, b: 0.55 }
const LIP = { r: 0.95, g: 0.15, b: 0.2 }
const MOUTH = { r: 0.9, g: 0.45, b: 0.15 }

function colorDist(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export function isLipColor(r, g, b) {
  if (r < LIP_STROKE_MIN_R || g > LIP_STROKE_MAX_G || b > LIP_STROKE_MAX_B) return false
  if (r - g < LIP_STROKE_MIN_RG_DELTA || r - b < LIP_STROKE_MIN_RB_DELTA) return false
  for (const ref of LIP_STROKE_REFS) {
    if (colorDist([r, g, b], ref) <= LIP_STROKE_TOL) return true
  }
  return false
}

/** @deprecated tan mouth fill on UV — not used for export */
export function isOuterMouthColor(r, g, b) {
  return false
}

export function classifyMouthUvRgb(r, g, b) {
  if (isLipColor(r, g, b)) return 'lip'
  return null
}

/** Red lip stroke vertices from T_Gray_Head_D UV sample. */
export function classifyLipFromUv(geometry, headCount, imageData, texW, texH) {
  const uv = geometry.getAttribute('uv')?.array
  if (!uv?.length) return null
  const lip = []
  for (let i = 0; i < headCount; i++) {
    const u = uv[i * 2]
    const v = uv[i * 2 + 1]
    const px = Math.min(texW - 1, Math.max(0, Math.round(u * (texW - 1))))
    const py = Math.min(texH - 1, Math.max(0, Math.round((1.0 - v) * (texH - 1))))
    const o = (py * texW + px) * 4
    if (isLipColor(imageData[o], imageData[o + 1], imageData[o + 2])) lip.push(i)
  }
  return { lip, mouth: [], lipCount: lip.length, mouthCount: 0 }
}

/** @deprecated use classifyLipFromUv */
export function classifyLipAndRing(geometry, headCount, imageData, texW, texH) {
  return classifyLipFromUv(geometry, headCount, imageData, texW, texH)
}

export function compareVertexIdSets(a, b) {
  const setA = a instanceof Set ? a : new Set(a || [])
  const setB = b instanceof Set ? b : new Set(b || [])
  let onlyA = 0
  let onlyB = 0
  for (const id of setA) if (!setB.has(id)) onlyA += 1
  for (const id of setB) if (!setA.has(id)) onlyB += 1
  return { onlyA, onlyB, match: onlyA === 0 && onlyB === 0 }
}

export { SKIN, LIP, MOUTH }
