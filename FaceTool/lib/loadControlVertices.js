/** @typedef {{ headVertexCount: number, numVertices: number, guiCount: number, names: string[], counts: number[], offsets: number[], indices: number[], controls?: { index: number, name: string, count: number, headCount: number }[] }} GuiControlVertices */

/** @returns {Promise<GuiControlVertices|null>} */
export async function loadGuiControlVertices() {
  try {
    const r = await fetch('/api/riglogic?gui_control_vertices=1')
    if (r.ok) {
      const data = await r.json()
      if (Array.isArray(data.indices) && data.indices.length >= 0) return data
    }
  } catch {}
  return null
}

/** @param {GuiControlVertices} data @param {number} index */
export function vertsForGuiControl(data, index) {
  if (!data || index == null || index < 0 || index >= data.counts.length) return []
  const start = data.offsets[index]
  const end = data.offsets[index + 1]
  return data.indices.slice(start, end)
}

/** @param {GuiControlVertices} data @param {number[]} indices @param {number} [headMax] */
export function unionVertsForGuiControls(data, indices, headMax = Infinity) {
  if (!data || !indices?.length) return []
  const out = new Set()
  for (const index of indices) {
    if (index == null || index < 0 || index >= data.counts.length) continue
    const start = data.offsets[index]
    const end = data.offsets[index + 1]
    for (let i = start; i < end; i++) {
      const vid = data.indices[i]
      if (vid < headMax) out.add(vid)
    }
  }
  return [...out]
}

/** @param {GuiControlVertices} data @param {number} index */
export function controlVertMeta(data, index) {
  const row = data?.controls?.[index]
  if (row) return row
  return {
    count: data?.counts?.[index] ?? 0,
    headCount: 0,
    name: data?.names?.[index] ?? '',
  }
}
