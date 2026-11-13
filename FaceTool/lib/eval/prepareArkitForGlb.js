import { EXPECTED_BLENDSHAPE_NAMES } from '@/lib/blendshapeCsvValidation'

const EYE_LOOK_DEADZONE = 0.03

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function normalizeName(name) {
  return String(name || '').trim()
}

function nameKey(name) {
  return normalizeName(name).toLowerCase()
}

/** NPY/추론 데이터 → GLB face.glb용 canonical ARKit 51 순서 + 값 정규화 */
export function prepareArkitForGlbViewer(trainingData) {
  if (!trainingData?.data?.length) return trainingData

  const sourceNames = trainingData.blendshapes || []
  const indexByKey = new Map()
  sourceNames.forEach((name, idx) => {
    const key = nameKey(name)
    if (!indexByKey.has(key)) indexByKey.set(key, idx)
  })

  const canonical = [...EXPECTED_BLENDSHAPE_NAMES]
  const data = trainingData.data.map((row) =>
    canonical.map((name) => {
      const idx = indexByKey.get(nameKey(name))
      let v = idx !== undefined ? row[idx] : 0
      v = clamp01(v)
      if (/^eyelook/i.test(name) && v < EYE_LOOK_DEADZONE) v = 0
      return v
    }),
  )

  return {
    ...trainingData,
    blendshapes: canonical,
    data,
    frames: data.length,
    duration: data.length / (trainingData.fps || 30),
    outputKind: 'arkit_51',
  }
}
