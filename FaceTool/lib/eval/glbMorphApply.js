/**
 * GLB morph target 적용 (DualFaceViewer / Overlay / Heatmap 공통)
 */

export function resolveMorphIndex(dictionary, name) {
  if (!dictionary || name == null) return undefined
  if (dictionary[name] !== undefined) return dictionary[name]

  const lower = String(name).toLowerCase()
  for (const [key, idx] of Object.entries(dictionary)) {
    if (key.toLowerCase() === lower) return idx
  }
  return undefined
}

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/**
 * @param {THREE.Mesh} mesh
 * @param {string[]} blendshapes
 * @param {number[]} frameData
 * @param {{ reset?: boolean, clamp?: boolean }} options
 */
export function applyBlendshapeFrameToMesh(mesh, blendshapes, frameData, options = {}) {
  const { reset = true, clamp = true } = options
  const influences = mesh.morphTargetInfluences
  const dictionary = mesh.morphTargetDictionary
  if (!influences || !dictionary || !blendshapes?.length || !frameData) return

  if (reset) {
    for (let i = 0; i < influences.length; i += 1) influences[i] = 0
  }

  for (let i = 0; i < blendshapes.length; i += 1) {
    let value = frameData[i]
    if (value === undefined) continue
    value = clamp ? clamp01(value) : Number(value) || 0
    const index = resolveMorphIndex(dictionary, blendshapes[i])
    if (index !== undefined && index < influences.length) {
      influences[index] = value
    }
  }
}

/** 씬 내 모든 morphable mesh에 프레임 적용 */
export function applyBlendshapeFrameToScene(scene, blendshapeData, frameIndex, options = {}) {
  if (!scene || !blendshapeData?.data || !blendshapeData?.blendshapes) return
  const frames = blendshapeData.frames ?? blendshapeData.data.length
  if (frames <= 0) return

  const clamped = Math.max(0, Math.min(frameIndex, frames - 1))
  const frameData = blendshapeData.data[clamped]
  if (!frameData) return

  scene.traverse((child) => {
    if (child.isMesh && child.morphTargetInfluences && child.morphTargetDictionary) {
      applyBlendshapeFrameToMesh(
        child,
        blendshapeData.blendshapes,
        frameData,
        options,
      )
    }
  })
}
