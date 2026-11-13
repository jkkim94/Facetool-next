import { RIGLOGIC_LOD } from './riglogicLod'

/** @typedef {{ id: number, key: string, label: string, color: number[], vertexCount?: number }} FaceRegionMeta */
/** @typedef {{ headVertexCount: number, regions: FaceRegionMeta[], vertexRegion: number[], vertexColors?: number[][], rawMeshColors?: number[][] }} FaceRegions */

/** MetaHuman Identity PCA 22 regions (LOD 0). @returns {Promise<FaceRegions|null>} */
export async function loadFaceRegionsIdentity() {
  try {
    const r = await fetch(`/api/riglogic?face_regions=identity&lod=${RIGLOGIC_LOD}`)
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.vertexRegion) && Array.isArray(data.regions)) return data
    }
  } catch {}
  return null
}

/** FACS dominant-control regions. @returns {Promise<FaceRegions|null>} */
export async function loadFaceRegionsFacs() {
  try {
    const r = await fetch('/api/riglogic?face_regions=facs')
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.vertexRegion) && Array.isArray(data.regions)) return data
    }
  } catch {}
  return null
}

/** @deprecated use loadFaceRegionsIdentity */
export async function loadFaceRegions() {
  return loadFaceRegionsIdentity()
}

/** Creator gizmo Voronoi (7 semantic groups, clean patches). @returns {Promise<FaceRegions|null>} */
export async function loadFaceRegionsCreator() {
  try {
    const r = await fetch(`/api/riglogic?face_regions=creator&lod=${RIGLOGIC_LOD}`)
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.vertexRegion) && Array.isArray(data.regions)) return data
    }
  } catch {}
  return null
}

/** MeshColorAsset 16-bucket + raw RGB (debug). @returns {Promise<FaceRegions|null>} */
export async function loadFaceRegionsMeshColor() {
  try {
    const r = await fetch('/api/riglogic?face_regions=meshcolor')
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.regions)) return data
    }
  } catch {}
  return null
}
