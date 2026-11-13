import * as THREE from 'three'
import {
  classifyLipFromUv,
  compareVertexIdSets,
} from './grayHeadUvClassify'
import {
  RIGLOGIC_HEAD_VERTEX_COUNT,
  resolveHeadVertexCountFromPayload,
} from './riglogicLod'
import { paintDnaWmMaskVertices } from './dnaWmMaskPaint'

const SKIN = new THREE.Color(0.78, 0.62, 0.55)
const GRAY_HEAD = new THREE.Color(0.72, 0.72, 0.76)
const GRAY_TEETH = new THREE.Color(0.88, 0.86, 0.82)
const GRAY_EYE = new THREE.Color(0.78, 0.80, 0.84)
const LIP = new THREE.Color(0.95, 0.15, 0.2)
const MOUTH = new THREE.Color(0.9, 0.45, 0.15)
const CONTROL = new THREE.Color(0.25, 0.82, 0.95)
const CONTROL_STRONG = new THREE.Color(0.95, 0.2, 0.15)
const TEETH_BASE = new THREE.Color(0.92, 0.9, 0.85)
const EYE_BASE = new THREE.Color(0.75, 0.78, 0.82)
/** MH-LVE-LIP-v1 subgroup colors (matches mask_preview_script.py palette) */
const LIP_MASK_SKIN = new THREE.Color(0.42, 0.36, 0.34)
const LIP_MASK_COLORS = {
  upper_outer_lip: new THREE.Color(0.90, 0.25, 0.10),
  lower_outer_lip: new THREE.Color(0.15, 0.45, 0.95),
  upper_inner_lip: new THREE.Color(0.95, 0.78, 0.10),
  lower_inner_lip: new THREE.Color(0.15, 0.80, 0.40),
  left_mouth_corner: new THREE.Color(0.80, 0.15, 0.80),
  right_mouth_corner: new THREE.Color(0.05, 0.78, 0.78),
}
const MOUTH_REGION_MASK_COLOR = new THREE.Color(0.92, 0.52, 0.12)
const LOWER_FACE_MASK_COLOR = new THREE.Color(0.48, 0.38, 0.88)
const LIP_GAP_HINT = new THREE.Color(0.25, 0.82, 0.95)
const _lerpA = new THREE.Color()
const _lerpB = new THREE.Color()
const _lerpOut = new THREE.Color()
const _tmp = new THREE.Color()

/** @deprecated use resolveHeadVertexCountFromPayload from riglogicLod.js */
function resolveHeadVertexCount(data, numVertices) {
  return resolveHeadVertexCountFromPayload(data, numVertices)
}

/** @param {Array<{ id: number, color: number[] }>} regions */
function buildPalette(regions) {
  const palette = []
  for (const r of regions || []) {
    if (r?.id != null && Array.isArray(r.color)) {
      palette[r.id] = new THREE.Color(r.color[0], r.color[1], r.color[2])
    }
  }
  return palette
}

function majorityRegion(a, b, c) {
  const counts = new Map()
  for (const r of [a, b, c]) {
    if (r == null || r < 0) continue
    counts.set(r, (counts.get(r) || 0) + 1)
  }
  if (!counts.size) return -1
  let best = -1
  let bestN = 0
  for (const [r, n] of counts) {
    if (n > bestN) { best = r; bestN = n }
  }
  return best
}

/** Indexed mesh: face majority -> vertex majority (avoids per-triangle overwrite speckle). */
function paintSolidFaceRegions(geometry, fr, headCount, meshStarts, arr) {
  const palette = buildPalette(fr.regions)
  const vr = fr.vertexRegion
  if (!vr?.length || !palette.length) return false

  const index = geometry.index
  if (!index) {
    for (let i = 0; i < headCount; i++) {
      const rid = vr[i]
      const c = (rid != null && rid >= 0 && palette[rid]) ? palette[rid] : SKIN
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
  } else {
    const idx = index.array
    const vertFaceCounts = new Array(headCount)
    for (let i = 0; i < headCount; i++) vertFaceCounts[i] = null

    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]
      const b = idx[t + 1]
      const c = idx[t + 2]
      if (a >= headCount && b >= headCount && c >= headCount) continue
      const rid = majorityRegion(vr[a], vr[b], vr[c])
      if (rid < 0) continue
      for (const vi of [a, b, c]) {
        if (vi >= headCount) continue
        let m = vertFaceCounts[vi]
        if (!m) { m = new Map(); vertFaceCounts[vi] = m }
        m.set(rid, (m.get(rid) || 0) + 1)
      }
    }

    for (let i = 0; i < headCount; i++) {
      let rid = vr[i]
      const m = vertFaceCounts[i]
      if (m && m.size > 0) {
        let best = -1
        let bestN = 0
        for (const [r, n] of m) {
          if (n > bestN) { best = r; bestN = n }
        }
        rid = best
      }
      const col = (rid != null && rid >= 0 && palette[rid]) ? palette[rid] : SKIN
      arr[i * 3] = col.r
      arr[i * 3 + 1] = col.g
      arr[i * 3 + 2] = col.b
    }
  }

  const numVerts = arr.length / 3
  for (let i = headCount; i < (meshStarts[2] ?? numVerts); i++) {
    arr[i * 3] = TEETH_BASE.r
    arr[i * 3 + 1] = TEETH_BASE.g
    arr[i * 3 + 2] = TEETH_BASE.b
  }
  for (let i = meshStarts[2] ?? headCount; i < numVerts; i++) {
    arr[i * 3] = EYE_BASE.r
    arr[i * 3 + 1] = EYE_BASE.g
    arr[i * 3 + 2] = EYE_BASE.b
  }
  return true
}

/** Epic runtime: weighted RGB mix; face-average smooths indexed-mesh speckle. */
function paintSoftRegionColors(geometry, fr, headCount, meshStarts, arr) {
  const soft = fr.vertexColorsSoft
  if (!soft?.length || soft.length < headCount) return false

  const raw = new Float32Array(headCount * 3)
  for (let i = 0; i < headCount; i++) {
    const dc = soft[i]
    if (Array.isArray(dc) && dc.length >= 3) {
      raw[i * 3] = dc[0]
      raw[i * 3 + 1] = dc[1]
      raw[i * 3 + 2] = dc[2]
    } else {
      raw[i * 3] = SKIN.r
      raw[i * 3 + 1] = SKIN.g
      raw[i * 3 + 2] = SKIN.b
    }
  }

  const index = geometry.index
  if (index) {
    const idx = index.array
    const vertAcc = new Array(headCount)
    for (let t = 0; t < idx.length; t += 3) {
      const ia = idx[t]
      const ib = idx[t + 1]
      const ic = idx[t + 2]
      if (ia >= headCount && ib >= headCount && ic >= headCount) continue
      let fr = 0
      let fg = 0
      let fb = 0
      let n = 0
      for (const vi of [ia, ib, ic]) {
        if (vi >= headCount) continue
        fr += raw[vi * 3]
        fg += raw[vi * 3 + 1]
        fb += raw[vi * 3 + 2]
        n += 1
      }
      if (!n) continue
      fr /= n
      fg /= n
      fb /= n
      for (const vi of [ia, ib, ic]) {
        if (vi >= headCount) continue
        let acc = vertAcc[vi]
        if (!acc) {
          acc = { r: 0, g: 0, b: 0, n: 0 }
          vertAcc[vi] = acc
        }
        acc.r += fr
        acc.g += fg
        acc.b += fb
        acc.n += 1
      }
    }
    for (let i = 0; i < headCount; i++) {
      const acc = vertAcc[i]
      if (acc?.n > 0) {
        arr[i * 3] = acc.r / acc.n
        arr[i * 3 + 1] = acc.g / acc.n
        arr[i * 3 + 2] = acc.b / acc.n
      } else {
        arr[i * 3] = raw[i * 3]
        arr[i * 3 + 1] = raw[i * 3 + 1]
        arr[i * 3 + 2] = raw[i * 3 + 2]
      }
    }
  } else {
    for (let i = 0; i < headCount * 3; i++) arr[i] = raw[i]
  }

  const numVerts = arr.length / 3
  for (let i = headCount; i < (meshStarts[2] ?? numVerts); i++) {
    arr[i * 3] = TEETH_BASE.r
    arr[i * 3 + 1] = TEETH_BASE.g
    arr[i * 3 + 2] = TEETH_BASE.b
  }
  for (let i = meshStarts[2] ?? headCount; i < numVerts; i++) {
    arr[i * 3] = EYE_BASE.r
    arr[i * 3 + 1] = EYE_BASE.g
    arr[i * 3 + 2] = EYE_BASE.b
  }
  return true
}

/** PCA mouth channel weight 0..1; optional face-average + UV multiply tint. */
function paintMouthWeightColors(geometry, fr, headCount, meshStarts, arr, opts = {}) {
  const {
    multiplyBlend = false,
    faceAverage = false,
    weightMin = 0,
    weightMax = 1,
    intensity = 1.5,
  } = opts
  const mw = fr.vertexMouthWeight
  if (!mw?.length) return false

  const minW = Math.max(0, Math.min(0.999, weightMin))
  const maxW = Math.max(minW + 1e-6, Math.min(1, weightMax))
  const gain = Math.max(0.25, Math.min(4, intensity))
  const span = Math.max(maxW - minW, 1e-6)

  const raw = new Float32Array(headCount)
  for (let i = 0; i < headCount; i++) {
    raw[i] = Math.max(0, Math.min(1, mw[i] ?? 0))
  }

  let weights = raw
  if (faceAverage && geometry?.index) {
    const idx = geometry.index.array
    const smoothed = new Float32Array(headCount)
    const vertAcc = new Array(headCount)
    for (let t = 0; t < idx.length; t += 3) {
      const ia = idx[t]
      const ib = idx[t + 1]
      const ic = idx[t + 2]
      if (ia >= headCount && ib >= headCount && ic >= headCount) continue
      let sum = 0
      let n = 0
      for (const vi of [ia, ib, ic]) {
        if (vi < headCount) { sum += raw[vi]; n += 1 }
      }
      if (!n) continue
      const avg = sum / n
      for (const vi of [ia, ib, ic]) {
        if (vi >= headCount) continue
        let acc = vertAcc[vi]
        if (!acc) { acc = { s: 0, n: 0 }; vertAcc[vi] = acc }
        acc.s += avg
        acc.n += 1
      }
    }
    for (let i = 0; i < headCount; i++) {
      const acc = vertAcc[i]
      smoothed[i] = acc?.n > 0 ? acc.s / acc.n : raw[i]
      // never inflate above per-vertex PCA weight (prevents ear/eye leak via long triangles)
      smoothed[i] = Math.min(smoothed[i], raw[i])
    }
    weights = smoothed
  }

  const gDrop = Math.min(0.995, 0.55 + 0.28 * gain)
  const bDrop = Math.min(0.995, 0.62 + 0.33 * gain)

  for (let i = 0; i < headCount; i++) {
    let t = 0
    if (weights[i] >= minW) {
      t = (Math.min(weights[i], maxW) - minW) / span
      t = Math.min(1, t * gain)
    }
    if (multiplyBlend) {
      // MeshBasicMaterial: fragment = texture * vertexColor
      arr[i * 3] = 1
      arr[i * 3 + 1] = 1 - t * gDrop
      arr[i * 3 + 2] = 1 - t * bDrop
    } else {
      _lerpA.copy(SKIN)
      _lerpB.setRGB(0.98, 0.08, 0.12)
      _lerpOut.copy(_lerpA).lerp(_lerpB, t)
      arr[i * 3] = _lerpOut.r
      arr[i * 3 + 1] = _lerpOut.g
      arr[i * 3 + 2] = _lerpOut.b
    }
  }
  const numVerts = arr.length / 3
  for (let i = headCount; i < (meshStarts[2] ?? numVerts); i++) {
    arr[i * 3] = TEETH_BASE.r
    arr[i * 3 + 1] = TEETH_BASE.g
    arr[i * 3 + 2] = TEETH_BASE.b
  }
  for (let i = meshStarts[2] ?? headCount; i < numVerts; i++) {
    arr[i * 3] = EYE_BASE.r
    arr[i * 3 + 1] = EYE_BASE.g
    arr[i * 3 + 2] = EYE_BASE.b
  }
  return true
}

function mouthWeightPaintOpts(data) {
  return {
    weightMin: data?.mouthWeightMin ?? 0,
    weightMax: data?.mouthWeightMax ?? 1,
    intensity: data?.mouthWeightIntensity ?? 1.5,
  }
}

function countMouthWeightAbove(fr, threshold) {
  const min = threshold ?? 0
  return fr?.vertexMouthWeight?.filter((w) => w >= min).length ?? null
}

function syncRegionWireframe(mesh, geometry, visible) {
  if (!mesh) return
  let wire = mesh.userData._regionWire
  if (!visible) {
    if (wire) wire.visible = false
    return
  }
  if (!wire) {
    wire = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x111111, depthTest: true }),
    )
    wire.renderOrder = 2
    mesh.add(wire)
    mesh.userData._regionWire = wire
  }
  if (wire.geometry) wire.geometry.dispose()
  wire.geometry = new THREE.WireframeGeometry(geometry)
  wire.visible = true
}

function restoreHighlightMaterials(mesh, materials) {
  if (mesh.userData._savedMaterials) {
    mesh.material = mesh.userData._savedMaterials
    delete mesh.userData._savedMaterials
    return mesh.material
  }
  return materials
}

function setIdentityUvMaterials(mesh, materials, texture, enabled) {
  const baseMats = mesh.userData._baseMaterials || materials
  const mats = Array.isArray(baseMats) ? baseMats : [baseMats]
  if (enabled && texture) {
    if (!mesh.userData._savedMaterials) {
      mesh.userData._savedMaterials = mats
    }
    const greyTeeth = new THREE.MeshBasicMaterial({ color: 0xe8e4dc, side: THREE.DoubleSide })
    const greyEye = new THREE.MeshBasicMaterial({ color: 0xc8ccd4, side: THREE.DoubleSide })
    const headMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    })
    const out = mats.map((m, i) => {
      const isHead = mats.length > 1 ? i === 0 : true
      if (isHead) return headMat
      if (i === 1) return greyTeeth
      return greyEye
    })
    mesh.material = out.length === 1 ? out[0] : out
    return mesh.material
  }
  return restoreHighlightMaterials(mesh, materials)
}

function setMouthWeightOverlayMaterials(mesh, materials, texture, enabled) {
  if (!enabled || !texture) {
    return restoreHighlightMaterials(mesh, materials)
  }
  const materialOut = setIdentityUvMaterials(mesh, materials, texture, true)
  const active = Array.isArray(materialOut) ? materialOut : [materialOut]
  active.forEach((m, i) => {
    const isHead = active.length > 1 ? i === 0 : true
    if (isHead) {
      m.vertexColors = true
      m.map = texture
      m.needsUpdate = true
    }
  })
  return materialOut
}

function setRegionViewMaterials(mesh, materials, enabled) {
  const baseMats = mesh.userData._baseMaterials || materials
  const mats = Array.isArray(baseMats) ? baseMats : [baseMats]
  if (enabled) {
    if (!mesh.userData._savedMaterials) {
      mesh.userData._savedMaterials = mats
    }
    let out = mesh.userData._highlightBasicMaterials
    if (!out || out.length !== mats.length) {
      const greyTeeth = new THREE.MeshBasicMaterial({ color: 0xe8e4dc, side: THREE.DoubleSide })
      const greyEye = new THREE.MeshBasicMaterial({ color: 0xc8ccd4, side: THREE.DoubleSide })
      out = mats.map((m, i) => {
        const isHead = mats.length > 1 ? i === 0 : true
        if (isHead) {
          return new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            toneMapped: false,
          })
        }
        if (i === 1) return greyTeeth
        return greyEye
      })
      mesh.userData._highlightBasicMaterials = out
    }
    mesh.material = out.length === 1 ? out[0] : out
    return mesh.material
  }
  return restoreHighlightMaterials(mesh, materials)
}

function paintFlatVertexMask(
  mesh,
  geometry,
  mats,
  meshHeadCount,
  numVertices,
  data,
  mask,
  highlightColor,
  apiName,
) {
  syncRegionWireframe(mesh, geometry, false)
  if (!mask?.ids?.length) {
    return {
      material: mats,
      diag: { error: `${apiName} 데이터 없음 — /api/riglogic?${apiName}=1 확인` },
    }
  }
  if (mask.headVertexCount && mask.headVertexCount > meshHeadCount) {
    return {
      material: mats,
      diag: {
        error: `mask head[${mask.headVertexCount}] > mesh head[${meshHeadCount}] — LOD 불일치`,
        mismatch: true,
        maskHeadCount: mask.headVertexCount,
        meshHeadCount,
      },
    }
  }
  const paintHeadCount = meshHeadCount
  const meshStartsLm = data?.meshVertexStarts || [0, paintHeadCount, numVertices]
  const baseLm = (i) => {
    if (i < meshStartsLm[1]) return LIP_MASK_SKIN
    if (i < meshStartsLm[2]) return TEETH_BASE
    return EYE_BASE
  }
  const idSet = new Set(mask.ids)
  const materialOut = setRegionViewMaterials(mesh, mats, true)
  const attr = ensureColorAttribute(geometry, numVertices)
  const arr = attr.array
  let paintedVerts = 0
  for (let i = 0; i < numVertices; i++) {
    let c = baseLm(i)
    if (i < paintHeadCount && idSet.has(i)) {
      c = highlightColor
      paintedVerts += 1
    }
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  attr.needsUpdate = true
  if (paintedVerts === 0) {
    return {
      material: mats,
      diag: {
        error: `${apiName} 0/${mask.vertexCount} verts painted — headCount=${paintHeadCount}`,
        vertexCount: mask.vertexCount,
        headCount: paintHeadCount,
        meshHeadCount,
      },
    }
  }
  const activeMats = Array.isArray(materialOut) ? materialOut : [materialOut]
  activeMats.forEach((m, i) => {
    const isHead = activeMats.length > 1 ? i === 0 : true
    if (isHead) {
      m.vertexColors = true
      m.map = null
      m.userData._vertexHighlight = true
      m.needsUpdate = true
    }
  })
  return {
    material: materialOut,
    diag: {
      ok: true,
      method: mask.protocol || apiName,
      headVertexCount: paintHeadCount,
      vertexCount: mask.vertexCount,
      paintedVerts,
    },
  }
}

/**
 * @param {'off'|'lip'|'mouth'|'control'|'control_pick'|'regions'|'identity_uv'|'uv_mouth'|'lip_mask'|'mouth_region_mask'|'lower_face_mask'} mode
 * @returns {{ material?: THREE.Material|THREE.Material[], diag?: object }}
 */
export function applyVertexHighlight(mesh, geometry, materials, mode, data) {
  const mats = Array.isArray(materials) ? materials : [materials]
  const numVertices = geometry.attributes.position.count
  const meshHeadCount = resolveHeadVertexCount(data, numVertices)
  const frPreview = data?.faceRegions
  const pcaHeadCount = frPreview?.headVertexCount
    ?? frPreview?.vertexMouthWeight?.length
    ?? frPreview?.vertexRegion?.length
    ?? meshHeadCount
  const headCount = Math.min(pcaHeadCount, meshHeadCount)
  const stylePreview = data?.regionStyle || 'patches'
  const mouthWeightOverlay = mode === 'regions' && stylePreview === 'mouth_weight' && !!data?.regionUvTexture
  const regionDebug = mode === 'regions' && data?.regionWireframe !== false
    && stylePreview !== 'mouth_weight'

  if (mode === 'identity_uv') {
    geometry.deleteAttribute('color')
    syncRegionWireframe(mesh, geometry, true)
    if (!data?.regionUvTexture) {
      return {
        material: materials,
        diag: { error: 'T_Gray_Head_D.PNG 없음 — serve.py 재시작 후 /texture?name=gray_head_regions 확인' },
      }
    }
    const materialOut = setIdentityUvMaterials(mesh, mats, data.regionUvTexture, true)
    return {
      material: materialOut,
      diag: {
        ok: true,
        method: 'T_Gray_Head_D.PNG (UV region map)',
        headVertexCount: headCount,
        regionStyle: 'uv_texture',
      },
    }
  }

  if (mode === 'uv_mouth') {
    syncRegionWireframe(mesh, geometry, false)
    const srcTex = data?.regionUvTexture
    if (!srcTex?.image?.width) {
      return {
        material: materials,
        diag: { error: 'T_Gray_Head_D.PNG 없음' },
      }
    }
    const meshStartsUv = data?.meshVertexStarts || [0, headCount, numVertices]
    const baseForUv = (i) => {
      if (i < meshStartsUv[1]) return SKIN
      if (i < meshStartsUv[2]) return TEETH_BASE
      return EYE_BASE
    }
    const img = srcTex.image
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = img.width
    sampleCanvas.height = img.height
    const sampleCtx = sampleCanvas.getContext('2d')
    sampleCtx.drawImage(img, 0, 0)
    const sampleData = sampleCtx.getImageData(0, 0, img.width, img.height)
    const sampled = classifyLipFromUv(
      geometry,
      headCount,
      sampleData.data,
      img.width,
      img.height,
    )
    if (!sampled?.lip?.length && !sampled?.mouth?.length) {
      return { material: materials, diag: { error: '입술·입 주변 vertex 없음' } }
    }
    const lipSet = new Set(sampled.lip)
    const mouthSet = new Set(sampled.mouth)
    const materialOut = setRegionViewMaterials(mesh, mats, true)
    const attr = ensureColorAttribute(geometry, numVertices)
    const arr = attr.array
    for (let i = 0; i < numVertices; i++) {
      let c = baseForUv(i)
      if (i < headCount) {
        if (lipSet.has(i)) c = LIP
        else if (mouthSet.has(i)) c = MOUTH
      }
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    attr.needsUpdate = true
    const diag = {
      ok: true,
      method: 'T_Gray_Head_D red lip stroke UV only',
      headVertexCount: headCount,
      lipCount: sampled.lipCount,
      mouthCount: sampled.mouthCount,
      unionCount: sampled.lipCount + sampled.mouthCount,
    }
    if (data.lip?.length || data.mouth?.length) {
      const lipCmp = compareVertexIdSets(data.lip, sampled.lip)
      const mouthCmp = compareVertexIdSets(data.mouth, sampled.mouth)
      diag.csvMatch = lipCmp.match && mouthCmp.match
      diag.csvDiff = {
        lipOnlyInCsv: lipCmp.onlyA,
        lipOnlyInUv: lipCmp.onlyB,
        mouthOnlyInCsv: mouthCmp.onlyA,
        mouthOnlyInUv: mouthCmp.onlyB,
      }
    }
    const activeMats = Array.isArray(materialOut) ? materialOut : [materialOut]
    activeMats.forEach((m, i) => {
      const isHead = activeMats.length > 1 ? i === 0 : true
      if (isHead) {
        m.vertexColors = true
        m.map = null
        m.userData._vertexHighlight = true
        m.needsUpdate = true
      }
    })
    return { material: materialOut, diag }
  }

  if (mode === 'lip_mask') {
    syncRegionWireframe(mesh, geometry, false)
    const mask = data?.lipMask
    if (!mask?.allLip?.length) {
      return {
        material: materials,
        diag: { error: 'lip mask 데이터 없음 — /api/riglogic?lip_mask=1 확인' },
      }
    }
    if (mask.headVertexCount && mask.headVertexCount > meshHeadCount) {
      return {
        material: materials,
        diag: {
          error: `mask head[${mask.headVertexCount}] > mesh head[${meshHeadCount}] — LOD 불일치 (serve.py RIGLOGIC_LOD=0 확인)`,
          mismatch: true,
          maskHeadCount: mask.headVertexCount,
          meshHeadCount,
        },
      }
    }
    const lipPaintHeadCount = meshHeadCount
    const singleColor = data?.lipMaskSingleColor === true
    const meshStartsLm = data?.meshVertexStarts || [0, lipPaintHeadCount, numVertices]
    const baseLm = (i) => {
      if (i < meshStartsLm[1]) return LIP_MASK_SKIN
      if (i < meshStartsLm[2]) return TEETH_BASE
      return EYE_BASE
    }
    // vertex id -> subgroup color (paint corners last so they win overlaps)
    const colorById = new Map()
    const groupCounts = {}
    for (const name of Object.keys(LIP_MASK_COLORS)) {
      const color = LIP_MASK_COLORS[name]
      const ids = mask.groups?.[name]
      if (!Array.isArray(ids)) continue
      groupCounts[name] = ids.length
      for (const vid of ids) colorById.set(vid, color)
    }
    const allLipSet = new Set(mask.allLip)
    const materialOut = setRegionViewMaterials(mesh, mats, true)
    const attr = ensureColorAttribute(geometry, numVertices)
    const arr = attr.array
    let paintedVerts = 0
    for (let i = 0; i < numVertices; i++) {
      let c = baseLm(i)
      if (i < lipPaintHeadCount && allLipSet.has(i)) {
        c = singleColor ? LIP : (colorById.get(i) || LIP)
        paintedVerts += 1
      }
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    attr.needsUpdate = true
    if (paintedVerts === 0) {
      return {
        material: materials,
        diag: {
          error: `lip mask 0/${mask.allLipCount} verts painted — headCount=${lipPaintHeadCount}`,
          allLipCount: mask.allLipCount,
          headCount: lipPaintHeadCount,
          meshHeadCount,
        },
      }
    }
    const activeMats = Array.isArray(materialOut) ? materialOut : [materialOut]
    activeMats.forEach((m, i) => {
      const isHead = activeMats.length > 1 ? i === 0 : true
      if (isHead) {
        m.vertexColors = true
        m.map = null
        m.userData._vertexHighlight = true
        m.needsUpdate = true
      }
    })
    return {
      material: materialOut,
      diag: {
        ok: true,
        method: `LVE lip mask (${mask.protocol})`,
        headVertexCount: lipPaintHeadCount,
        allLipCount: mask.allLipCount,
        paintedVerts,
        groupCounts,
        view: singleColor ? 'all_lip 단일색' : 'subgroup 6색',
      },
    }
  }

  if (mode === 'mouth_region_mask') {
    return paintFlatVertexMask(
      mesh, geometry, mats, meshHeadCount, numVertices, data,
      data?.mouthRegionMask, MOUTH_REGION_MASK_COLOR, 'mouth_region_mask',
    )
  }

  if (mode === 'lower_face_mask') {
    return paintFlatVertexMask(
      mesh, geometry, mats, meshHeadCount, numVertices, data,
      data?.lowerFaceMask, LOWER_FACE_MASK_COLOR, 'lower_face_mask',
    )
  }

  if (mode === 'dna_wm_masks') {
    syncRegionWireframe(mesh, geometry, false)
    const bundle = data?.dnaWmMaskBundle
    const images = bundle?.images
    if (!images?.length) {
      return {
        material: materials,
        diag: {
          error: 'DNA WM mask TGA 없음 — /api/riglogic?dna_wm_masks=1 및 TGA 로드 확인',
        },
      }
    }
    const paintHeadCount = meshHeadCount
    const meshStartsWm = data?.meshVertexStarts || [0, paintHeadCount, numVertices]
    const materialOut = setRegionViewMaterials(mesh, mats, true)
    const attr = ensureColorAttribute(geometry, numVertices)
    const paintOut = paintDnaWmMaskVertices(
      geometry,
      paintHeadCount,
      numVertices,
      meshStartsWm,
      images,
      {
        threshold: bundle.threshold ?? 0.12,
        selection: bundle.selection ?? 'all',
        colorAttr: attr,
      },
    )
    if (paintOut.error) {
      return { material: materials, diag: { error: paintOut.error } }
    }
    const activeMats = Array.isArray(materialOut) ? materialOut : [materialOut]
    activeMats.forEach((m, i) => {
      const isHead = activeMats.length > 1 ? i === 0 : true
      if (isHead) {
        m.vertexColors = true
        m.map = null
        m.userData._vertexHighlight = true
        m.needsUpdate = true
      }
    })
    const meta = bundle.manifest?.metadata || {}
    return {
      material: materialOut,
      diag: {
        ok: true,
        method: paintOut.method,
        headVertexCount: paintHeadCount,
        paintedVerts: paintOut.paintedVerts,
        maskCount: paintOut.maskCount,
        threshold: paintOut.threshold,
        perMaskCounts: paintOut.perMaskCounts,
        uvWrap: meta.uv_wrap,
        meshName: meta.mesh_name || 'head_lod0_mesh',
        selection: bundle.selection ?? 'all',
      },
    }
  }

  if (mode === 'off') {
    geometry.deleteAttribute('color')
    syncRegionWireframe(mesh, geometry, false)
    const restored = restoreHighlightMaterials(mesh, materials)
    ;(Array.isArray(restored) ? restored : [restored]).forEach((m) => {
      m.vertexColors = false
      if (m.userData._skinMap && !m.userData._debugSavedMap) {
        m.map = m.userData._skinMap
      }
      if (m.userData._debugSavedMap !== undefined) {
        m.map = m.userData._debugSavedMap
        delete m.userData._debugSavedMap
      }
      delete m.userData._vertexHighlight
      m.needsUpdate = true
    })
    return { material: restored }
  }

  const meshStarts = data?.meshVertexStarts || [0, headCount, numVertices]
  const baseFor = (i) => {
    if (mode === 'control_pick') {
      if (i < meshStarts[1]) return GRAY_HEAD
      if (i < meshStarts[2]) return GRAY_TEETH
      return GRAY_EYE
    }
    if (mode !== 'control') return SKIN
    if (i < meshStarts[1]) return SKIN
    if (i < meshStarts[2]) return TEETH_BASE
    return EYE_BASE
  }

  const attr = ensureColorAttribute(geometry, numVertices)
  const arr = attr.array
  let materialOut = materials
  let diag = null

  if (mode === 'regions') {
    const fr = data?.faceRegions
    const style = data.regionStyle || 'patches'
    const regionLen = fr?.vertexColorsSoft?.length ?? fr?.vertexRegion?.length ?? fr?.vertexMouthWeight?.length ?? 0
    const pcaCount = fr?.headVertexCount ?? regionLen
    if (!regionLen && !fr?.vertexColors?.length) {
      return { material: materials, diag: { error: 'faceRegions 데이터 없음' } }
    }
    if (regionLen && pcaCount && regionLen !== pcaCount) {
      return {
        material: materials,
        diag: {
          error: `region arrays[${regionLen}] ≠ PCA head[${pcaCount}]`,
          headVertexCount: headCount,
          regionArrayLen: regionLen,
          mismatch: true,
        },
      }
    }
    if (pcaCount && meshHeadCount !== pcaCount) {
      return {
        material: materials,
        diag: {
          error: `mesh head[${meshHeadCount}] ≠ PCA head[${pcaCount}] — export_identity_face_regions.py --lod 0 재실행`,
          headVertexCount: headCount,
          meshHeadCount,
          pcaHeadCount: pcaCount,
          geoLod: 0,
          mismatch: true,
        },
      }
    }
    if (style === 'mouth_weight' && !data?.regionUvTexture) {
      return {
        material: materials,
        diag: {
          error: 'T_Gray_Head_D.PNG 없음 — Identity UV와 동일 텍스처 필요',
          regionStyle: style,
        },
      }
    }

    if (mouthWeightOverlay) {
      syncRegionWireframe(mesh, geometry, false)
      materialOut = setMouthWeightOverlayMaterials(mesh, materials, data.regionUvTexture, true)
      let ok = paintMouthWeightColors(geometry, fr, headCount, meshStarts, arr, {
        multiplyBlend: true,
        faceAverage: data?.mouthWeightSmooth === true,
        ...mouthWeightPaintOpts(data),
      })
      if (!ok) {
        materialOut = setIdentityUvMaterials(mesh, materials, data.regionUvTexture, true)
      }
      diag = {
        ok,
        regionStyle: style,
        mouthWeightMin: data?.mouthWeightMin ?? 0,
        mouthWeightIntensity: data?.mouthWeightIntensity ?? 1.5,
        mouthWeightVerts: countMouthWeightAbove(fr, data?.mouthWeightMin ?? 0),
        partition: fr.partition || 'soft',
        headVertexCount: headCount,
        meshHeadCount,
        pcaHeadCount: pcaCount,
        meshVertices: numVertices,
        regionArrayLen: fr.vertexMouthWeight?.length ?? 0,
        method: 'T_Gray_Head_D + PCA mouth weight overlay',
        overlay: 'uv_multiply',
      }
    } else if (regionDebug) {
      syncRegionWireframe(mesh, geometry, true)
      materialOut = setRegionViewMaterials(mesh, mats, true)
      let ok = false
      if (style === 'mouth_weight') {
        ok = paintMouthWeightColors(geometry, fr, headCount, meshStarts, arr, {
          faceAverage: data?.mouthWeightSmooth === true,
          ...mouthWeightPaintOpts(data),
        })
        if (!ok) ok = paintSoftRegionColors(geometry, fr, headCount, meshStarts, arr)
      } else if (style === 'soft') {
        ok = paintSoftRegionColors(geometry, fr, headCount, meshStarts, arr)
        if (!ok) ok = paintSolidFaceRegions(geometry, fr, headCount, meshStarts, arr)
      } else {
        ok = paintSolidFaceRegions(geometry, fr, headCount, meshStarts, arr)
      }
      diag = {
        ok,
        regionStyle: style,
        mouthWeightMin: data?.mouthWeightMin ?? 0,
        mouthWeightIntensity: data?.mouthWeightIntensity ?? 1.5,
        mouthWeightVerts: countMouthWeightAbove(fr, data?.mouthWeightMin ?? 0),
        partition: fr.partition || (style === 'soft' ? 'soft' : 'hard'),
        headVertexCount: headCount,
        meshVertices: numVertices,
        regionArrayLen: fr.vertexRegion?.length ?? 0,
        multiRegionVertices: fr.diagnostics?.multiRegionVertices,
        method: fr.method || '',
        mismatch: fr.vertexRegion?.length !== headCount,
      }
    } else {
      syncRegionWireframe(mesh, geometry, false)
      materialOut = setRegionViewMaterials(mesh, mats, false)
      const palette = buildPalette(fr.regions)
      for (let i = 0; i < numVertices; i++) {
        let c = SKIN
        if (i < headCount) {
          const rid = fr.vertexRegion?.[i]
          if (rid != null && rid >= 0 && palette[rid]) c = palette[rid]
          else {
            const dc = fr.vertexColors?.[i]
            if (Array.isArray(dc) && dc.length >= 3) c = _tmp.setRGB(dc[0], dc[1], dc[2])
          }
        } else if (i < meshStarts[2]) c = TEETH_BASE
        else c = EYE_BASE
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
    }
  } else {
    syncRegionWireframe(mesh, geometry, false)
    // Flat MeshBasicMaterial — PBR lighting on vertex colors caused false L/R brightness split.
    materialOut = setRegionViewMaterials(mesh, mats, true)

    if ((mode === 'control' || mode === 'control_pick') && data.vertexDeltas?.length) {
      const deltas = data.vertexDeltas
      const minD = data.minDeltaCm ?? 0
      if (mode === 'control_pick') {
        for (let i = 0; i < numVertices; i++) {
          let c = baseFor(i)
          if (i < headCount && i < deltas.length && deltas[i] >= minD) c = CONTROL
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      } else {
        let maxD = data.maxDeltaCm
        if (maxD == null || maxD <= minD) {
          maxD = minD
          for (let i = 0; i < Math.min(headCount, deltas.length); i++) {
            if (deltas[i] > maxD) maxD = deltas[i]
          }
        }
        const span = Math.max(maxD - minD, 1e-6)
        for (let i = 0; i < numVertices; i++) {
          let c = baseFor(i)
          if (i < headCount && i < deltas.length) {
            const d = deltas[i]
            if (d >= minD) {
              const t = Math.min(1, (d - minD) / span)
              _lerpA.copy(SKIN)
              _lerpB.copy(CONTROL).lerp(CONTROL_STRONG, t)
              c = _lerpOut.copy(_lerpA).lerp(_lerpB, t)
            }
          }
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      }
    } else {
      let ids
      let accent
      if (mode === 'control' || mode === 'control_pick') {
        ids = data.activeIds instanceof Set ? data.activeIds : new Set(data.activeIds || [])
        accent = CONTROL
      } else if (mode === 'mouth') {
        ids = new Set(data.mouth || [])
        accent = MOUTH
      } else {
        ids = new Set(data.lip || [])
        accent = LIP
      }
      if (mode === 'control' && ids.size === 0) {
        for (let i = 0; i < numVertices; i++) {
          const c = baseFor(i)
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      } else if (mode === 'control' && ids.size > 0) {
        for (let i = 0; i < numVertices; i++) {
          const c = ids.has(i) ? accent : baseFor(i)
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      } else if (mode === 'control_pick') {
        for (let i = 0; i < numVertices; i++) {
          const c = ids.has(i) ? accent : baseFor(i)
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      } else {
        if (ids.size === 0) return { material: materials }
        for (let i = 0; i < numVertices; i++) {
          const c = ids.has(i) ? accent : baseFor(i)
          arr[i * 3] = c.r
          arr[i * 3 + 1] = c.g
          arr[i * 3 + 2] = c.b
        }
      }
    }
  }
  attr.needsUpdate = true

  const activeMats = Array.isArray(materialOut) ? materialOut : [materialOut]
  activeMats.forEach((m, i) => {
    const isHead = mesh?.material?.length ? i === 0 : true
    const useColors = (mode === 'regions' && isHead)
      || (mode === 'control' && isHead)
      || (mode === 'control_pick' && isHead)
      || (mode !== 'regions' && mode !== 'control' && mode !== 'control_pick' && isHead)
    if (!useColors) {
      m.vertexColors = false
      m.needsUpdate = true
      return
    }
    if (!regionDebug && !mouthWeightOverlay && m.userData._debugSavedMap === undefined) {
      m.userData._debugSavedMap = m.map ?? null
    }
    if (!regionDebug && !mouthWeightOverlay) {
      m.userData._vertexHighlight = true
      m.map = null
    }
    m.vertexColors = (mode === 'regions' && isHead) ? true : mode !== 'regions'
    m.needsUpdate = true
  })
  return { material: materialOut, diag }
}

/** Call after deforming vertices so wireframe / vertex dots follow the mesh. */
export function syncRegionWireframeGeometry(mesh, geometry) {
  const wire = mesh?.userData._regionWire
  if (wire?.visible) {
    wire.geometry.dispose()
    wire.geometry = new THREE.WireframeGeometry(geometry)
  }
}

/** @param {THREE.BufferGeometry} geometry */
export function ensureColorAttribute(geometry, numVertices) {
  if (!geometry.getAttribute('color')) {
    const colors = new Float32Array(numVertices * 3)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  return geometry.getAttribute('color')
}
