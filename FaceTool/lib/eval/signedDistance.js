import * as THREE from 'three'

/** GT vertex 기준 방사형 normal */
export function radialNormals(positions, V) {
  const center = new THREE.Vector3(0, 0, 0)
  for (let i = 0; i < V; i++) {
    center.x += positions[i * 3]
    center.y += positions[i * 3 + 1]
    center.z += positions[i * 3 + 2]
  }
  center.multiplyScalar(1 / V)
  const normals = new Float32Array(V * 3)
  for (let i = 0; i < V; i++) {
    const nx = positions[i * 3] - center.x
    const ny = positions[i * 3 + 1] - center.y
    const nz = positions[i * 3 + 2] - center.z
    const len = Math.hypot(nx, ny, nz) || 1
    normals[i * 3] = nx / len
    normals[i * 3 + 1] = ny / len
    normals[i * 3 + 2] = nz / len
  }
  return normals
}

/** gt/pred position buffers (V*3) → signed distance per vertex (meters) */
export function computeSignedDistances(gtPos, predPos, V) {
  const normals = radialNormals(gtPos, V)
  const out = new Float32Array(V)
  for (let i = 0; i < V; i++) {
    const dx = predPos[i * 3] - gtPos[i * 3]
    const dy = predPos[i * 3 + 1] - gtPos[i * 3 + 1]
    const dz = predPos[i * 3 + 2] - gtPos[i * 3 + 2]
    out[i] =
      dx * normals[i * 3] + dy * normals[i * 3 + 1] + dz * normals[i * 3 + 2]
  }
  return out
}

export function signedDistanceToRgb(signedDist, minScale, maxScale) {
  let normalized
  if (signedDist >= 0) {
    normalized = Math.min(1, signedDist / Math.abs(maxScale || 1e-6))
    if (normalized < 0.5) {
      return {
        r: normalized * 2,
        g: 1,
        b: 1 - normalized * 2,
      }
    }
    return {
      r: 1,
      g: 1 - (normalized - 0.5) * 2,
      b: 0,
    }
  }
  normalized = Math.max(-1, signedDist / Math.abs(minScale || 1e-6))
  const absNorm = -normalized
  if (absNorm < 0.5) {
    return {
      r: 0,
      g: 1,
      b: absNorm * 2,
    }
  }
  return {
    r: 0,
    g: 1 - (absNorm - 0.5) * 2,
    b: 1,
  }
}

export function computeHistogram(signedDistances, minVal, maxVal, numBins = 20) {
  const bins = new Array(numBins).fill(0)
  const range = maxVal - minVal || 1e-6
  const binWidth = range / numBins
  for (let i = 0; i < signedDistances.length; i++) {
    const v = signedDistances[i]
    let bin = Math.floor((v - minVal) / binWidth)
    if (bin < 0) bin = 0
    if (bin >= numBins) bin = numBins - 1
    bins[bin] += 1
  }
  const maxCount = Math.max(...bins, 1)
  return {
    bins,
    normalizedBins: bins.map((c) => c / maxCount),
    minVal,
    maxVal,
    binWidth,
    total: signedDistances.length,
  }
}

export function scanGlobalSignedRange(
  deformFrame,
  assets,
  gtFrames,
  predFrames,
  totalFrames,
  evalVertexCount = null,
) {
  const V = evalVertexCount || assets.V
  const gtFull = new Float32Array(assets.V * 3)
  const predFull = new Float32Array(assets.V * 3)
  const gtOut = V < assets.V ? new Float32Array(V * 3) : gtFull
  const predOut = V < assets.V ? new Float32Array(V * 3) : predFull
  let globalMin = 0
  let globalMax = 0
  let sumDist = 0
  let sumSq = 0
  let totalVertices = 0
  const sampleInterval = Math.max(1, Math.floor(totalFrames / 40))
  let sampledFrames = 0

  for (let f = 0; f < totalFrames; f += sampleInterval) {
    const gf = gtFrames[Math.min(f, gtFrames.length - 1)]
    const pf = predFrames[Math.min(f, predFrames.length - 1)]
    if (!gf || !pf) continue
    deformFrame(assets, gf.bs, gf.jo, gtFull)
    deformFrame(assets, pf.bs, pf.jo, predFull)
    if (V < assets.V) {
      gtOut.set(gtFull.subarray(0, V * 3))
      predOut.set(predFull.subarray(0, V * 3))
    }
    const dists = computeSignedDistances(gtOut, predOut, V)
    for (let i = 0; i < V; i++) {
      const d = dists[i]
      if (d > globalMax) globalMax = d
      if (d < globalMin) globalMin = d
      sumDist += d
      sumSq += d * d
      totalVertices += 1
    }
    sampledFrames += 1
  }

  const mean = totalVertices > 0 ? sumDist / totalVertices : 0
  const variance = totalVertices > 0 ? sumSq / totalVertices - mean * mean : 0
  const std = Math.sqrt(Math.max(0, variance))

  return {
    globalMin: globalMin * 1000,
    globalMax: globalMax * 1000,
    mean: mean * 1000,
    std: std * 1000,
    totalFrames,
    sampledFrames,
    scanned: true,
  }
}
