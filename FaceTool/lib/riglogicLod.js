/** MetaHuman RigLogic pipeline — LOD 0 only (head_lod0_mesh vertex order). */
export const RIGLOGIC_LOD = 0

/** head_lod0_mesh vertex count for DNA 0421_V33 (combined mesh also has teeth/eyes). */
export const RIGLOGIC_HEAD_VERTEX_COUNT = 24049

/**
 * Head-only vertex count from viewer state (never the teeth/eyes combined total).
 * @param {{ headVertexCount?: number, numVertices?: number, meshVertexStarts?: number[] }|null|undefined} st
 */
export function resolveViewerHeadCount(st) {
  const total = Number(st?.numVertices) || 0
  const starts = st?.meshVertexStarts
  if (Array.isArray(starts) && starts.length >= 2) {
    const h = Number(starts[1])
    if (Number.isFinite(h) && h > 0) return h
  }
  const h = Number(st?.headVertexCount)
  if (Number.isFinite(h) && h > 0 && (total <= 0 || h < total)) return h
  return RIGLOGIC_HEAD_VERTEX_COUNT
}

/**
 * @param {{ headVertexCount?: number, meshVertexStarts?: number[] }|null|undefined} data
 * @param {number} numVertices
 */
export function resolveHeadVertexCountFromPayload(data, numVertices) {
  const total = Number(numVertices) || 0
  const starts = data?.meshVertexStarts
  if (Array.isArray(starts) && starts.length >= 2) {
    const fromStarts = Number(starts[1])
    if (Number.isFinite(fromStarts) && fromStarts > 0) return fromStarts
  }
  const h = Number(data?.headVertexCount)
  if (Number.isFinite(h) && h > 0 && (total <= 0 || h < total)) return h
  if (total >= RIGLOGIC_HEAD_VERTEX_COUNT) return RIGLOGIC_HEAD_VERTEX_COUNT
  if (Number.isFinite(h) && h > 0) return h
  return total
}

/** MeshStandard(lit) only — vertex-color debug modes use MeshBasic (no normals). */
export function highlightNeedsLitNormals(mode) {
  const m = mode === 'lip_mask_single' ? 'lip_mask' : mode
  return m === 'off'
}
