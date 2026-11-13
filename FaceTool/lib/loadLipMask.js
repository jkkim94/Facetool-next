import { RIGLOGIC_LOD } from './riglogicLod'

/**
 * LVE lip vertex mask (MH-LVE-LIP-v1) loader.
 * FaceTool: /api/riglogic?lip_mask=1
 * serve.py fallback: {serverBase}/lip_mask?lod=0
 *
 * @typedef {{
 *   protocol: string,
 *   headVertexCount: number,
 *   groups: Record<string, number[]>,
 *   allLip: number[],
 *   allLipCount: number,
 *   groupCounts: Record<string, number> | null,
 *   source: string,
 * }} LipMask
 */

export const LIP_MASK_GROUP_ORDER = [
  'upper_outer_lip',
  'lower_outer_lip',
  'upper_inner_lip',
  'lower_inner_lip',
  'left_mouth_corner',
  'right_mouth_corner',
  'all_manual',
]

function normIds(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0)
}

/** @param {object} data */
function parseLipMaskPayload(data, source) {
  if (!data?.lip_vertices || !data?.combined?.all_lip) return null
  const groups = {}
  for (const name of LIP_MASK_GROUP_ORDER) {
    const ids = normIds(data.lip_vertices[name])
    if (ids.length) groups[name] = ids
  }
  const allLip = normIds(data.combined.all_lip)
  if (!allLip.length) return null
  return {
    protocol: data.metadata?.protocol || 'unknown',
    headVertexCount: Number(data.metadata?.total_head_vertex_count) || 0,
    groups,
    allLip,
    allLipCount: data.statistics?.all_lip_count ?? allLip.length,
    groupCounts: data.statistics?.group_counts || null,
    source,
  }
}

/** @returns {Promise<LipMask|null>} */
export async function loadLipMask(serverBase = '') {
  const lod = RIGLOGIC_LOD
  try {
    const r = await fetch(`/api/riglogic?lip_mask=1&lod=${lod}`)
    if (r.ok) {
      const parsed = parseLipMaskPayload(await r.json(), 'facetool_api')
      if (parsed) return parsed
    }
  } catch {
    /* try serve fallback */
  }

  if (serverBase) {
    try {
      const r = await fetch(`${serverBase}/lip_mask?lod=${lod}`)
      if (r.ok) {
        const parsed = parseLipMaskPayload(await r.json(), 'serve_py')
        if (parsed) return parsed
      }
    } catch {
      /* ignore */
    }
  }

  return null
}

export { RIGLOGIC_LOD }
