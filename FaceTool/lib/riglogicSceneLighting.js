/**
 * RigLogic MetaHuman 뷰어용 3점 조명 (key / fill / rim) + PBR 렌더 설정.
 */
export function addRiglogicThreePointLighting(scene, THREE) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.38))

  const key = new THREE.DirectionalLight(0xfff5ee, 1.35)
  key.position.set(45, 65, 85)
  scene.add(key)
  scene.add(key.target)

  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6)
  fill.position.set(-65, 28, 48)
  scene.add(fill)
  scene.add(fill.target)

  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.52)
  rim.position.set(0, 38, -95)
  scene.add(rim)
  scene.add(rim.target)

  const focusTarget = (y = 0) => {
    for (const light of [key, fill, rim]) {
      light.target.position.set(0, y, 0)
    }
  }
  focusTarget(0)

  return { key, fill, rim, focusTarget }
}

export function configureRiglogicRenderer(renderer, THREE) {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
}
