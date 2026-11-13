import * as THREE from 'three'

/** eval 렌더: head + teeth(혀), eye 제외 */
export function isEvalFaceMesh(meshName) {
  const n = (meshName || '').toLowerCase()
  if (n.startsWith('eyeleft') || n.startsWith('eyeright')) return false
  if (n.startsWith('head_')) return true
  if (n.startsWith('teeth_')) return true
  return false
}

/** meshVertexStarts 기준 head+teeth 연속 구간 정점 수 */
export function resolveEvalVertexCount(meshNames, meshVertexStarts) {
  if (!meshNames?.length || !meshVertexStarts?.length) return 0
  let end = 0
  for (let i = 0; i < meshNames.length; i++) {
    if (!isEvalFaceMesh(meshNames[i])) continue
    const segStart = meshVertexStarts[i]
    const segEnd = meshVertexStarts[i + 1]
    if (segEnd == null) break
    if (segStart !== end) break
    end = segEnd
  }
  if (end > 0) return end
  return meshVertexStarts[1] ?? 0
}

/** head LOD0 — 해당 구간 정점만 포함하는 index/uv 서브셋 */
export function extractHeadMesh(indices, uvs, headVertexCount) {
  const V = headVertexCount
  if (!V || V <= 0) {
    return {
      headVertexCount: 0,
      indices: indices.slice(),
      uvs: uvs.slice(),
    }
  }

  const headIndices = []
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    if (a < V && b < V && c < V) headIndices.push(a, b, c)
  }

  return {
    headVertexCount: V,
    indices: new Uint32Array(headIndices),
    uvs: uvs.slice(0, V * 2),
  }
}

function filterIndicesByVertexCount(indices, V) {
  const out = []
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    if (a < V && b < V && c < V) out.push(a, b, c)
  }
  return new Uint32Array(out)
}

/** head + teeth, eye 제외 — index/uv + material groups */
export function extractEvalFaceMesh(indices, uvs, meshNames, meshVertexStarts, groups) {
  const evalV = resolveEvalVertexCount(meshNames, meshVertexStarts)
  if (!evalV) {
    const headOnly = extractHeadMesh(indices, uvs, meshVertexStarts?.[1] ?? 0)
    return { ...headOnly, evalVertexCount: headOnly.headVertexCount, groups: [] }
  }

  const evalGroups = filterEvalFaceGroups(groups)
  if (groups?.length && evalGroups.length) {
    const buckets = evalGroups.map(() => [])
    const bucketIndex = new Map(evalGroups.map((g, i) => [g.name, i]))

    for (const gr of groups) {
      if (!isEvalFaceMesh(gr.name)) continue
      const bi = bucketIndex.get(gr.name)
      if (bi == null) continue
      const start = gr.indexStart
      const end = start + gr.indexCount
      for (let i = start; i + 2 < end; i += 3) {
        const a = indices[i]
        const b = indices[i + 1]
        const c = indices[i + 2]
        if (a < evalV && b < evalV && c < evalV) buckets[bi].push(a, b, c)
      }
    }

    let totalLen = 0
    for (let gi = 0; gi < evalGroups.length; gi++) {
      totalLen += buckets[gi].length
    }
    const flat = new Uint32Array(totalLen)
    const outGroups = []
    let elem = 0
    for (let gi = 0; gi < evalGroups.length; gi++) {
      const tris = buckets[gi]
      if (!tris.length) continue
      outGroups.push({
        ...evalGroups[gi],
        indexStart: elem,
        indexCount: tris.length,
      })
      flat.set(tris, elem)
      elem += tris.length
    }

    return {
      evalVertexCount: evalV,
      headVertexCount: evalV,
      indices: flat,
      uvs: uvs.slice(0, evalV * 2),
      groups: outGroups,
    }
  }

  return {
    evalVertexCount: evalV,
    headVertexCount: evalV,
    indices: filterIndicesByVertexCount(indices, evalV),
    uvs: uvs.slice(0, evalV * 2),
    groups: [],
  }
}

/** groups 중 Head 계열만 */
export function filterHeadGroups(groups) {
  if (!groups?.length) return groups
  const head = groups.filter((gr) => {
    const n = (gr.name || '').toLowerCase()
    return n.includes('head') && !n.includes('eyebrow')
  })
  return head.length ? head : [groups[0]]
}

/** groups 중 head + teeth (eye 제외) */
export function filterEvalFaceGroups(groups) {
  if (!groups?.length) return []
  const filtered = groups.filter((gr) => isEvalFaceMesh(gr.name))
  return filtered.length ? filtered : filterHeadGroups(groups)
}

export function makeHeadGeometry(indices, uvs, headVertexCount) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2))
  g.setIndex(new THREE.BufferAttribute(indices.slice(), 1))
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(headVertexCount * 3), 3),
  )
  return g
}

export function makeEvalFaceGeometry(indices, uvs, evalVertexCount, evalGroups) {
  const g = makeHeadGeometry(indices, uvs, evalVertexCount)
  if (evalGroups?.length) {
    g.clearGroups()
    evalGroups.forEach((gr, i) => {
      g.addGroup(gr.indexStart, gr.indexCount, i)
    })
  }
  return g
}

export function slicePositions(fullPos, vertexCount) {
  return fullPos.subarray(0, vertexCount * 3)
}
