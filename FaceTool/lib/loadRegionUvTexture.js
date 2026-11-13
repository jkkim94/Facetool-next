/**
 * Load Epic T_Gray_Head_D.PNG for Identity UV region visualization.
 * @param {import('three').TextureLoader} loader
 * @param {import('three')} THREE
 * @param {string} [serverBase]
 * @returns {Promise<import('three').Texture|null>}
 */
export function loadRegionUvTexture(loader, THREE, serverBase = '') {
  return new Promise((resolve) => {
    const finish = (tex) => {
      if (!tex) return resolve(null)
      tex.flipY = true
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      resolve(tex)
    }
    loader.load('/api/riglogic?region_uv_texture=1', finish, undefined, () => {
      if (!serverBase) return resolve(null)
      loader.load(`${serverBase}/texture?name=gray_head_regions`, finish, undefined, () => resolve(null))
    })
  })
}
