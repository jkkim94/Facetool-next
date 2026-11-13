/**
 * DNA SourceAssets/masks TGA loaders (Epic WM weight masks, head_lod0 UV).
 */

/** @typedef {{
 *   index: number,
 *   file: string,
 *   mask_id: string,
 *   animated_map_name?: string,
 *   material_slot?: string,
 *   wm_layer?: string,
 * }} DnaWmMaskEntry */

/**
 * @param {string} [serverBase]
 * @returns {Promise<{ metadata: object, masks: DnaWmMaskEntry[] }|null>}
 */
export async function loadDnaWmMaskManifest(serverBase = '') {
  if (serverBase) {
    try {
      const r = await fetch(`${serverBase}/dna_wm_masks`)
      if (r.ok) return r.json()
    } catch {
      /* fallback to Next proxy */
    }
  }
  try {
    const r = await fetch('/api/riglogic?dna_wm_masks=1')
    if (r.ok) return r.json()
  } catch {
    /* ignore */
  }
  return null
}

function maskTgaUrl(file, serverBase) {
  if (serverBase) {
    return `${serverBase}/dna_wm_mask?file=${encodeURIComponent(file)}`
  }
  return `/api/riglogic?dna_wm_mask_tga=${encodeURIComponent(file)}`
}

/**
 * @param {typeof import('three')} THREE
 * @param {{ metadata: object, masks: DnaWmMaskEntry[] }} manifest
 * @param {string} [serverBase]
 * @param {{ onProgress?: (loaded: number, total: number) => void }} [opts]
 * @returns {Promise<Array<DnaWmMaskEntry & { width: number, height: number, data: Uint8Array }>>}
 */
export async function loadDnaWmMaskImages(THREE, manifest, serverBase = '', opts = {}) {
  const { TGALoader } = await import('three/examples/jsm/loaders/TGALoader.js')
  const loader = new TGALoader()
  const masks = manifest?.masks || []
  const total = masks.length
  const out = []

  for (let i = 0; i < masks.length; i += 1) {
    const entry = masks[i]
    const url = maskTgaUrl(entry.file, serverBase)
    const tex = await new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject)
    })
    const img = tex.image
    if (!img?.data || !img.width) {
      tex.dispose()
      throw new Error(`TGA load failed: ${entry.file}`)
    }
    out.push({
      ...entry,
      width: img.width,
      height: img.height,
      data: img.data,
    })
    tex.dispose()
    opts.onProgress?.(i + 1, total)
  }
  return out
}
