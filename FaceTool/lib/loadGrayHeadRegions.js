import { RIGLOGIC_LOD } from './riglogicLod'

/** @typedef {{ headVertexCount: number, mouth: number[], mouthCount: number, lip?: number[] }} GrayHeadRegions */

/** T_Gray_Head_D UV-sampled regions + mouth vertex mask (LOD 0). */
export async function loadGrayHeadRegions() {
  try {
    const r = await fetch(`/api/riglogic?gray_head_regions=1&lod=${RIGLOGIC_LOD}`)
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.mouth) && data.mouth.length > 0) return data
    }
  } catch {}
  return null
}

export { RIGLOGIC_LOD }
