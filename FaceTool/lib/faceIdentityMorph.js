/**
 * Identity PCA 구역 기반 얼굴 형태 오프셋 (안전 버전).
 *
 * 이전 방식(구역 centroid 기준 scale)은 경계 삼각형을 찢어
 * 메시가 녹아내리듯 깨졌음. 이제는:
 *  1) 얼굴 중심 기준의 약한 축 오프셋(cm)
 *  2) dominant weight 감쇠
 *  3) 변위 필드 라플라시안 스무딩
 */

/** @typedef {{ sx: number, sy: number, sz: number }} RegionScale */

const CM_PER_UNIT = 3.5 // slider 1.0±0.3 → 약 ±1.05cm
const MAX_DISP_CM = 2.0
const SMOOTH_ITERS = 3

/**
 * @param {Float32Array} verts
 * @param {number} headCount
 * @returns {Float32Array} [cx,cy,cz]
 */
export function computeFaceCenter(verts, headCount) {
  let x = 0
  let y = 0
  let z = 0
  const n = Math.max(1, headCount)
  for (let i = 0; i < headCount; i += 1) {
    const o = i * 3
    x += verts[o]
    y += verts[o + 1]
    z += verts[o + 2]
  }
  return new Float32Array([x / n, y / n, z / n])
}

/**
 * Build adjacency (unique neighbors) for head vertices from triangle indices.
 * @param {Uint32Array|number[]} indices
 * @param {number} headCount
 * @returns {number[][]}
 */
export function buildHeadAdjacency(indices, headCount) {
  /** @type {Set<number>[]} */
  const sets = Array.from({ length: headCount }, () => new Set())
  const triCount = Math.floor(indices.length / 3)
  for (let t = 0; t < triCount; t += 1) {
    const a = indices[t * 3]
    const b = indices[t * 3 + 1]
    const c = indices[t * 3 + 2]
    if (a >= headCount || b >= headCount || c >= headCount) continue
    sets[a].add(b); sets[a].add(c)
    sets[b].add(a); sets[b].add(c)
    sets[c].add(a); sets[c].add(b)
  }
  return sets.map((s) => Array.from(s))
}

/**
 * @param {Float32Array} delta  headCount*3
 * @param {number[][]} adj
 * @param {number} headCount
 * @param {number} iters
 */
function smoothDelta(delta, adj, headCount, iters) {
  if (!adj?.length || iters <= 0) return
  const tmp = new Float32Array(delta.length)
  for (let it = 0; it < iters; it += 1) {
    for (let i = 0; i < headCount; i += 1) {
      const nbrs = adj[i]
      const o = i * 3
      if (!nbrs?.length) {
        tmp[o] = delta[o]
        tmp[o + 1] = delta[o + 1]
        tmp[o + 2] = delta[o + 2]
        continue
      }
      let sx = delta[o]
      let sy = delta[o + 1]
      let sz = delta[o + 2]
      let w = 1
      for (let k = 0; k < nbrs.length; k += 1) {
        const j = nbrs[k]
        const jo = j * 3
        sx += delta[jo]
        sy += delta[jo + 1]
        sz += delta[jo + 2]
        w += 1
      }
      tmp[o] = sx / w
      tmp[o + 1] = sy / w
      tmp[o + 2] = sz / w
    }
    delta.set(tmp)
  }
}

/**
 * @param {Float32Array} src
 * @param {Float32Array} dst
 * @param {{
 *   headCount: number,
 *   vertexRegion: number[],
 *   dominantWeight?: number[],
 *   faceCenter: Float32Array,
 *   scales: RegionScale[],
 *   adjacency?: number[][],
 * }} opts
 */
export function applyIdentityMorph(src, dst, opts) {
  const {
    headCount,
    vertexRegion,
    dominantWeight,
    faceCenter,
    scales,
    adjacency,
  } = opts
  dst.set(src)
  if (!vertexRegion?.length || !scales?.length || !faceCenter) return dst

  let any = false
  for (let r = 0; r < scales.length; r += 1) {
    const s = scales[r]
    if (s && (s.sx !== 1 || s.sy !== 1 || s.sz !== 1)) {
      any = true
      break
    }
  }
  if (!any) return dst

  const cx = faceCenter[0]
  const cy = faceCenter[1]
  const cz = faceCenter[2]
  const delta = new Float32Array(headCount * 3)

  for (let i = 0; i < headCount; i += 1) {
    const rid = vertexRegion[i]
    if (rid == null || rid < 0) continue
    const s = scales[rid]
    if (!s || (s.sx === 1 && s.sy === 1 && s.sz === 1)) continue

    // soft-ish falloff: low dominant weight → almost no move (reduces hard cuts)
    const rawW = dominantWeight?.[i]
    const w = rawW == null ? 0.65 : Math.max(0, Math.min(1, rawW))
    if (w < 0.05) continue

    const o = i * 3
    const x = src[o]
    const y = src[o + 1]
    const z = src[o + 2]

    // 폭: 중선에서 멀어지는 방향 (양수 scale → 더 넓게)
    // 높이/깊이: 얼굴 중심에서 멀어지는 축 성분
    let dx = (x - cx) * (s.sx - 1) * w
    let dy = (y - cy) * (s.sy - 1) * w
    let dz = (z - cz) * (s.sz - 1) * w

    // 추가 평행 이동 성분(작은 cm) — 편측 구역이 한쪽으로만 쏠릴 때 보완
    dx += (s.sx - 1) * CM_PER_UNIT * 0.15 * w * (x >= cx ? 1 : -1)
    dy += (s.sy - 1) * CM_PER_UNIT * 0.15 * w
    dz += (s.sz - 1) * CM_PER_UNIT * 0.15 * w

    const len = Math.hypot(dx, dy, dz)
    if (len > MAX_DISP_CM && len > 1e-8) {
      const t = MAX_DISP_CM / len
      dx *= t
      dy *= t
      dz *= t
    }
    delta[o] = dx
    delta[o + 1] = dy
    delta[o + 2] = dz
  }

  if (adjacency?.length) {
    smoothDelta(delta, adjacency, headCount, SMOOTH_ITERS)
  }

  for (let i = 0; i < headCount; i += 1) {
    const o = i * 3
    dst[o] = src[o] + delta[o]
    dst[o + 1] = src[o + 1] + delta[o + 1]
    dst[o + 2] = src[o + 2] + delta[o + 2]
  }
  return dst
}

/** @returns {RegionScale} */
export function defaultRegionScale() {
  return { sx: 1, sy: 1, sz: 1 }
}

/**
 * @param {number} n
 * @returns {RegionScale[]}
 */
export function createDefaultScales(n) {
  return Array.from({ length: n }, () => defaultRegionScale())
}
