import { RIGLOGIC_LOD } from './riglogicLod'

export async function loadLipVertices(serverBase = 'http://localhost:8765') {
  try {
    const r = await fetch(`/api/riglogic?gray_head_regions=1&lod=${RIGLOGIC_LOD}`)
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.mouth) && data.mouth.length > 0) {
        return {
          ...data,
          lip: data.lip || data.mouth,
          lipCount: data.lipCount ?? data.mouthCount ?? data.mouth.length,
          mouthCount: data.mouthCount ?? data.mouth.length,
          source: 'T_Gray_Head_D',
          lod: RIGLOGIC_LOD,
        }
      }
    }
  } catch {}

  try {
    const r = await fetch('/api/riglogic?lip_vertices=1')
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.lip) && data.lip.length > 0) return data
    }
  } catch {}

  try {
    const r = await fetch(`${serverBase}/lip_vertices`)
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.lip) && data.lip.length > 0) return data
    }
  } catch {}

  return {}
}

export function lipMetaFrom(data) {
  return {
    lipCount: data.lipCount || data.lip?.length || 0,
    mouthCount: data.mouthCount || data.mouth?.length || 0,
    source: data.source || 'facs_controls',
    lod: RIGLOGIC_LOD,
  }
}

export { RIGLOGIC_LOD }
