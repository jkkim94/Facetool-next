import { RIGLOGIC_LOD } from './riglogicLod'

/**
 * Flat vertex ID mask loader (mouth region, lower face).
 * FaceTool: /api/riglogic?mouth_region_mask=1 | lower_face_mask=1
 * serve.py fallback: {serverBase}/mouth_region_mask | lower_face_mask
 *
 * @typedef {{
 *   protocol: string,
 *   headVertexCount: number,
 *   ids: number[],
 *   vertexCount: number,
 *   source: string,
 *   label: string,
 * }} FlatVertexMask
 */

function normIds(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0)
}

/** @param {object} data @param {string} source @param {string} label */
function parseFlatMaskPayload(data, source, label) {
  const ids = normIds(
    data?.ids
    ?? data?.combined?.all_lip
    ?? data?.vertex_ids,
  )
  if (!ids.length) return null
  return {
    protocol: data.metadata?.protocol || label,
    headVertexCount: Number(data.metadata?.total_head_vertex_count) || 0,
    ids,
    vertexCount: Number(data.count ?? data.statistics?.all_lip_count ?? ids.length),
    source,
    label,
  }
}

async function loadFlatMask(apiQuery, servePath, label, serverBase = '') {
  const lod = RIGLOGIC_LOD
  try {
    const r = await fetch(`/api/riglogic?${apiQuery}=1&lod=${lod}`)
    if (r.ok) {
      const parsed = parseFlatMaskPayload(await r.json(), 'facetool_api', label)
      if (parsed) return parsed
    }
  } catch {
    /* try serve fallback */
  }

  if (serverBase) {
    try {
      const r = await fetch(`${serverBase}/${servePath}?lod=${lod}`)
      if (r.ok) {
        const parsed = parseFlatMaskPayload(await r.json(), 'serve_py', label)
        if (parsed) return parsed
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

/** @returns {Promise<FlatVertexMask|null>} */
export function loadMouthRegionMask(serverBase = '') {
  return loadFlatMask('mouth_region_mask', 'mouth_region_mask', 'MH-LVE-MOUTHREGION-v1', serverBase)
}

/** @returns {Promise<FlatVertexMask|null>} */
export function loadLowerFaceMask(serverBase = '') {
  return loadFlatMask('lower_face_mask', 'lower_face_mask', 'MH-LVE-LOWERFACE-v1', serverBase)
}

export { RIGLOGIC_LOD, parseFlatMaskPayload }
