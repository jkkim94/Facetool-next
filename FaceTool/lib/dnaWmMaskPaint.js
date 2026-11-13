import * as THREE from 'three'

const SKIN = new THREE.Color(0.42, 0.36, 0.34)

/** Distinct colors for up to 64 WM masks (golden-angle HSL). */
export function dnaWmMaskColor(index, total = 37) {
  const hue = (index * 137.508) % 360
  const sat = 0.72
  const light = 0.42 + (index % 5) * 0.06
  return new THREE.Color().setHSL(hue / 360, sat, Math.min(light, 0.72))
}

/**
 * Sample grayscale weight at mesh UV (DNA head_lod0 layout, flipY like grayHeadUvClassify).
 * @param {Uint8Array} data RGBA from TGALoader
 */
export function sampleMaskWeightAtUv(data, texW, texH, u, v) {
  const px = Math.min(texW - 1, Math.max(0, Math.round(u * (texW - 1))))
  const py = Math.min(texH - 1, Math.max(0, Math.round((1.0 - v) * (texH - 1))))
  const o = (py * texW + px) * 4
  const r = data[o]
  const g = data[o + 1]
  const b = data[o + 2]
  return Math.max(r, g, b) / 255
}

/**
 * Paint head vertices from one or all DNA WM TGA masks (max-weight wins in multi mode).
 * @returns {{ paintedVerts: number, perMaskCounts: Record<string, number>, method: string }}
 */
export function paintDnaWmMaskVertices(
  geometry,
  headCount,
  numVertices,
  meshStarts,
  maskImages,
  {
    threshold = 0.12,
    selection = 'all',
    colorAttr,
  },
) {
  const uv = geometry.getAttribute('uv')?.array
  if (!uv?.length) {
    return { error: 'mesh has no UV attribute — DNA /uvs required' }
  }
  const base = (i) => {
    if (i < meshStarts[1]) return SKIN
    if (i < meshStarts[2]) return new THREE.Color(0.92, 0.9, 0.85)
    return new THREE.Color(0.75, 0.78, 0.82)
  }

  const arr = colorAttr.array
  const nMasks = maskImages.length
  const activeIndices = selection === 'all'
    ? maskImages.map((_, i) => i)
    : maskImages
      .map((m, i) => (m.mask_id === selection || m.file === selection || String(m.index) === selection ? i : -1))
      .filter((i) => i >= 0)

  if (!activeIndices.length) {
    return { error: `mask not found: ${selection}` }
  }

  const winner = new Int16Array(headCount).fill(-1)
  const maxW = new Float32Array(headCount)
  const perMaskCounts = {}

  for (const mi of activeIndices) {
    const m = maskImages[mi]
    perMaskCounts[m.mask_id || m.file] = 0
    for (let vi = 0; vi < headCount; vi += 1) {
      const w = sampleMaskWeightAtUv(m.data, m.width, m.height, uv[vi * 2], uv[vi * 2 + 1])
      if (w >= threshold && w > maxW[vi]) {
        maxW[vi] = w
        winner[vi] = mi
      }
    }
  }

  let paintedVerts = 0
  for (let i = 0; i < numVertices; i += 1) {
    let c = base(i)
    if (i < headCount) {
      const wi = winner[i]
      if (wi >= 0) {
        c = dnaWmMaskColor(wi, nMasks)
        paintedVerts += 1
        const key = maskImages[wi].mask_id || maskImages[wi].file
        perMaskCounts[key] = (perMaskCounts[key] || 0) + 1
      }
    }
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  colorAttr.needsUpdate = true

  return {
    paintedVerts,
    perMaskCounts,
    method: activeIndices.length > 1
      ? `DNA WM TGA composite (${activeIndices.length} masks, max-weight)`
      : `DNA WM TGA ${maskImages[activeIndices[0]].mask_id}`,
    threshold,
    maskCount: activeIndices.length,
  }
}

export { SKIN as DNA_WM_SKIN_BASE }
