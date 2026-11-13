import { RIGLOGIC_LOD } from './riglogicLod'

/** @typedef {{ lip: number[], mouth: number[], lipCount?: number, mouthCount?: number, headVertexCount?: number, lod?: number, source?: string }} UvMouthVertices */

/** UV lip/mouth vertex IDs from uv_mouth_vertices_lod0.csv (LOD 0 only). */
export async function loadUvMouthVertices(serverBase = '') {
  const lod = RIGLOGIC_LOD
  try {
    const r = await fetch(`/api/riglogic?uv_mouth_vertices=1&lod=${lod}`)
    if (r.ok) {
      const data = await r.json()
      if ((data.lip?.length || 0) + (data.mouth?.length || 0) > 0) return data
    }
  } catch {}

  if (serverBase) {
    try {
      const r = await fetch(`${serverBase}/uv_mouth_vertices?lod=${lod}`)
      if (r.ok) {
        const data = await r.json()
        if ((data.lip?.length || 0) + (data.mouth?.length || 0) > 0) return data
      }
    } catch {}
  }

  return null
}

export function uvMouthMetaFrom(data) {
  return {
    lipCount: data?.lipCount ?? data?.lip?.length ?? 0,
    mouthCount: data?.mouthCount ?? data?.mouth?.length ?? 0,
    unionCount: (data?.lip?.length ?? 0) + (data?.mouth?.length ?? 0),
    source: data?.source || 'uv_mouth_csv',
    lod: RIGLOGIC_LOD,
    headVertexCount: data?.headVertexCount,
  }
}

export { RIGLOGIC_LOD }
