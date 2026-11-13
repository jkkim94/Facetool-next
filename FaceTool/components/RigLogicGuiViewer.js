'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyVertexHighlight, syncRegionWireframeGeometry } from '../lib/riglogicVertexColors'
import { loadGuiControlVertices, unionVertsForGuiControls } from '../lib/loadControlVertices'
import { loadRegionUvTexture } from '../lib/loadRegionUvTexture'
import { loadUvMouthVertices, uvMouthMetaFrom } from '../lib/loadUvMouthVertices'
import { loadLipMask } from '../lib/loadLipMask'
import { loadMouthRegionMask, loadLowerFaceMask } from '../lib/loadVertexMask'
import { loadDnaWmMaskManifest, loadDnaWmMaskImages } from '../lib/loadDnaWmMasks'
import { dnaWmMaskColor } from '../lib/dnaWmMaskPaint'
import { fetchControlDeltas, countAboveThreshold } from '../lib/fetchControlDeltas'
import { parseDeformStatic, parseEvalRigFrame } from '../lib/loadDeformStatic'
import { deformFrame } from '../lib/riglogicDeform'
import { RIGLOGIC_LOD, resolveViewerHeadCount, highlightNeedsLitNormals } from '../lib/riglogicLod'
import {
  addRiglogicThreePointLighting,
  configureRiglogicRenderer,
} from '../lib/riglogicSceneLighting'
import FaceBoardPanel from './FaceBoardPanel'

const REGION_LABEL = {
  brow: '눈썹 (Brow)',
  eye: '눈 (Eye)',
  eyelashes: '속눈썹',
  nose: '코 (Nose)',
  mouth: '입 (Mouth)',
  jaw: '턱 (Jaw)',
  tongue: '혀 (Tongue)',
  teeth: '치아 (Teeth)',
  neck: '목 (Neck)',
  ear: '귀 (Ear)',
  other: '기타',
}
const REGION_ORDER = ['jaw', 'mouth', 'eye', 'brow', 'nose', 'tongue', 'eyelashes', 'teeth', 'neck', 'ear', 'other']

function updateMaskDiag(setDiag, next, geoLod) {
  const d = next ? { ...next, geoLod } : null
  setDiag((prev) => {
    if (!d && !prev) return prev
    if (d && prev
      && prev.ok === d.ok
      && prev.error === d.error
      && prev.paintedVerts === d.paintedVerts
      && prev.vertexCount === d.vertexCount
      && prev.allLipCount === d.allLipCount) {
      return prev
    }
    return d
  })
}

const VERTEX_MASK_MODES = new Set([
  'lip_mask', 'lip_mask_single', 'mouth_region_mask', 'lower_face_mask', 'dna_wm_masks',
])

async function ensureDnaWmMaskBundle(st, serverBase, setLoadStatus) {
  if (st.dnaWmMaskBundle?.images?.length) return st.dnaWmMaskBundle
  setLoadStatus?.('DNA WM mask TGA 로딩…')
  const manifest = await loadDnaWmMaskManifest(serverBase)
  if (!manifest?.masks?.length) {
    setLoadStatus?.('manifest 없음')
    return null
  }
  const images = await loadDnaWmMaskImages(THREE, manifest, serverBase, {
    onProgress: (n, t) => setLoadStatus?.(`TGA ${n}/${t}`),
  })
  st.dnaWmMaskBundle = {
    manifest,
    images,
    threshold: 0.12,
    selection: 'all',
  }
  setLoadStatus?.('')
  return st.dnaWmMaskBundle
}

async function ensureVertexMaskLoaded(mode, st, serverBase) {
  if ((mode === 'lip_mask' || mode === 'lip_mask_single') && !st.lipMask) {
    st.lipMask = await loadLipMask(serverBase)
  }
  if (mode === 'mouth_region_mask' && !st.mouthRegionMask) {
    st.mouthRegionMask = await loadMouthRegionMask(serverBase)
  }
  if (mode === 'lower_face_mask' && !st.lowerFaceMask) {
    st.lowerFaceMask = await loadLowerFaceMask(serverBase)
  }
}

function highlightNeedsRepaintAfterEval(mode) {
  return mode === 'control' || mode === 'control_pick'
}

export default function RigLogicGuiViewer({ serverBase: serverBaseProp, dnaProfileId = '' }) {
  const [serverBase, setServerBase] = useState(serverBaseProp || 'http://localhost:8765')
  useEffect(() => {
    if (serverBaseProp) return
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [serverBaseProp])
  const mountRef = useRef(null)
  const stateRef = useRef({})
  const valuesRef = useRef(null)
  const evalRef = useRef({ inFlight: false, dirty: false })
  const [status, setStatus] = useState('연결 중...')
  const [controls, setControls] = useState([])
  const [resetTick, setResetTick] = useState(0)
  const [vertexHighlight, setVertexHighlight] = useState('off')
  const [selectedControls, setSelectedControls] = useState([])
  const [regionDiag, setRegionDiag] = useState(null)
  const [uvMouthDiag, setUvMouthDiag] = useState(null)
  const [maskDiag, setMaskDiag] = useState(null)
  const [dnaWmMaskPick, setDnaWmMaskPick] = useState('all')
  const [dnaWmMaskLoadStatus, setDnaWmMaskLoadStatus] = useState('')
  const [dnaWmMaskList, setDnaWmMaskList] = useState([])
  const dnaWmMaskPickRef = useRef('all')
  const [deltaMeta, setDeltaMeta] = useState(null)
  const [regionUvReady, setRegionUvReady] = useState(false)
  const [panelMode, setPanelMode] = useState('faceboard') // faceboard | list
  const [meshViewMode, setMeshViewMode] = useState('texture') // texture | gray_pick
  const [pickVertCount, setPickVertCount] = useState(0)
  const [valueTick, setValueTick] = useState(0)
  const highlightRef = useRef('off')
  const meshViewModeRef = useRef('texture')
  const selectedRef = useRef([])
  const controlDeltasRef = useRef(null)
  const minDeltaRef = useRef(0.05)
  useEffect(() => { highlightRef.current = vertexHighlight }, [vertexHighlight])
  useEffect(() => { meshViewModeRef.current = meshViewMode }, [meshViewMode])
  useEffect(() => { dnaWmMaskPickRef.current = dnaWmMaskPick }, [dnaWmMaskPick])

  // three.js scene (once)
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1d24)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000)
    camera.position.set(0, 0, 80)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    configureRiglogicRenderer(renderer, THREE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    const controlsOrbit = new OrbitControls(camera, renderer.domElement)
    controlsOrbit.enableDamping = true
    controlsOrbit.dampingFactor = 0.08

    const lights = addRiglogicThreePointLighting(scene, THREE)

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controlsOrbit.update()
      renderer.render(scene, camera)
    }
    animate()
    Object.assign(stateRef.current, { scene, camera, renderer, controls: controlsOrbit, lights })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controlsOrbit.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // load geometry + gui controls
  useEffect(() => {
    if (!dnaProfileId) return undefined
    let cancelled = false
    const st = stateRef.current
    const u = (p) => `${serverBase}${p}`

    function disposeMesh() {
      if (!st.mesh) return
      st.scene?.remove(st.mesh)
      st.geometry?.dispose()
      const mats = st.mesh.material
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose())
      else mats?.dispose()
      st.mesh = null
      st.geometry = null
      st.material = null
    }

    async function load() {
      try {
        disposeMesh()
        setStatus('지오메트리 로딩...')
        const geo = await fetch(u('/geo')).then((r) => r.json())
        const gui = await fetch(u('/gui')).then((r) => r.json())
        const controlVerts = await loadGuiControlVertices()
        if (cancelled) return
        if (geo.lod != null && geo.lod !== RIGLOGIC_LOD) {
          console.warn(`[RigLogic] serve LOD ${geo.lod} != ${RIGLOGIC_LOD} — restart serve.py (RIGLOGIC_LOD=0)`)
        }
        st.geoLod = RIGLOGIC_LOD
        st.headVertexCount = geo.headVertexCount ?? geo.meshVertexStarts?.[1]
        st.meshVertexStarts = geo.meshVertexStarts
          || controlVerts?.meshVertexStarts
          || [0, st.headVertexCount, geo.numVertices]
        const [idxBuf, uvBuf, staticBuf] = await Promise.all([
          fetch(u(geo.indicesUrl)).then((r) => r.arrayBuffer()),
          fetch(u(geo.uvsUrl)).then((r) => r.arrayBuffer()),
          fetch('/api/riglogic/deform_static').then(async (r) => {
            if (!r.ok) {
              const j = await r.json().catch(() => ({}))
              throw new Error(j.error || `deform_static HTTP ${r.status}`)
            }
            return r.arrayBuffer()
          }),
        ])
        if (cancelled) return
        const deformAssets = parseDeformStatic(staticBuf)
        if (deformAssets.V !== geo.numVertices) {
          throw new Error(
            `vertex count mismatch: geo=${geo.numVertices} static=${deformAssets.V}`,
          )
        }
        st.deformAssets = deformAssets
        st.deformOut = new Float32Array(deformAssets.V * 3)
        const indices = new Uint32Array(idxBuf)
        const uvs = new Float32Array(uvBuf)

        const geometry = new THREE.BufferGeometry()
        const pos = new Float32Array(geo.numVertices * 3)
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
        geometry.setIndex(new THREE.BufferAttribute(indices, 1))

        const loader = new THREE.TextureLoader()
        loader.setCrossOrigin('anonymous')
        const loadTex = (name, cs) =>
          new Promise((resolve) => {
            loader.load(u(`/texture?name=${name}`), (t) => {
              t.flipY = true; t.colorSpace = cs; t.anisotropy = 8; resolve(t)
            }, undefined, () => resolve(null))
          })
        const loadRegionUvTex = () => loadRegionUvTexture(loader, THREE, serverBase)
        const regionUvTexture = await loadRegionUvTex()
        let uvMouth = null
        try {
          uvMouth = await loadUvMouthVertices(serverBase)
        } catch {
          uvMouth = null
        }
        const lipMask = await loadLipMask(serverBase)
        const mouthRegionMask = await loadMouthRegionMask(serverBase)
        const lowerFaceMask = await loadLowerFaceMask(serverBase)
        const roughnessFor = (n) => {
          const s = (n || '').toLowerCase()
          if (s.startsWith('eyeleft') || s.startsWith('eyeright')) return 0.18
          if (s.startsWith('teeth')) return 0.38
          return 0.62
        }
        const makeMaterial = (tex, name) => {
          const m = new THREE.MeshStandardMaterial({
            color: tex && tex.map ? 0xffffff : 0xc8a08c,
            roughness: roughnessFor(name), metalness: 0,
          })
          if (tex && tex.map) loadTex(tex.map, THREE.SRGBColorSpace).then((t) => {
            if (!cancelled && t) {
              m.userData._skinMap = t
              if (highlightRef.current === 'off'
                && meshViewModeRef.current === 'texture'
                && !m.userData._vertexHighlight) {
                m.map = t
                m.needsUpdate = true
              }
            }
          })
          if (tex && tex.normalMap) loadTex(tex.normalMap, THREE.NoColorSpace).then((t) => { if (!cancelled && t) { m.normalMap = t; m.needsUpdate = true } })
          return m
        }

        let material
        if (geo.groups && geo.groups.length) {
          geometry.clearGroups()
          material = geo.groups.map((g, i) => {
            geometry.addGroup(g.indexStart, g.indexCount, i)
            return makeMaterial(g.textures, g.name)
          })
        } else {
          material = makeMaterial({}, geo.meshes?.[0])
        }
        const mesh = new THREE.Mesh(geometry, material)
        mesh.frustumCulled = false
        mesh.userData._baseMaterials = material
        st.scene.add(mesh)

        const cy = (geo.bboxMax[1] + geo.bboxMin[1]) / 2
        const size = Math.max(
          geo.bboxMax[0] - geo.bboxMin[0],
          geo.bboxMax[1] - geo.bboxMin[1],
          geo.bboxMax[2] - geo.bboxMin[2],
        )
        st.lights?.focusTarget(cy)
        st.camera.position.set(0, cy, size * 2.2)
        st.controls.target.set(0, cy, 0)
        st.controls.update()

        st.mesh = mesh
        st.geometry = geometry
        st.material = material
        st.controlVerts = controlVerts
        if (
          controlVerts?.headVertexCount
          && st.headVertexCount
          && controlVerts.headVertexCount !== st.headVertexCount
        ) {
          console.warn(
            `[RigLogic] gui_control_vertices head ${controlVerts.headVertexCount}`
            + ` != geo head ${st.headVertexCount} — export_gui_control_vertices.py 재실행`,
          )
        }
        st.regionUvTexture = regionUvTexture
        st.uvMouth = uvMouth
        st.lipMask = lipMask
        st.mouthRegionMask = mouthRegionMask
        st.lowerFaceMask = lowerFaceMask
        setRegionUvReady(!!regionUvTexture)
        if (uvMouth) setUvMouthDiag(uvMouthMetaFrom(uvMouth))
        st.meshVertexStarts = controlVerts?.meshVertexStarts
          || st.meshVertexStarts
          || [0, st.headVertexCount, geo.numVertices]
        st.numVertices = geo.numVertices
        valuesRef.current = new Array(gui.count).fill(0)
        setControls(gui.controls)
        setStatus('ready')
        paintHighlight(highlightRef.current, selectedRef.current)
        evaluate() // neutral
      } catch (e) {
        if (!cancelled) setStatus('오류: ' + e.message + ' (serve.py 실행 확인)')
      }
    }
    load()
    return () => {
      cancelled = true
      disposeMesh()
    }
  }, [serverBase, dnaProfileId])

  const applyVertices = (arr) => {
    const st = stateRef.current
    if (!st.geometry) return
    st.geometry.attributes.position.array.set(arr)
    st.geometry.attributes.position.needsUpdate = true
    if (highlightNeedsLitNormals(highlightRef.current)) {
      st.geometry.computeVertexNormals()
    }
    if (highlightRef.current === 'identity_uv') {
      syncRegionWireframeGeometry(st.mesh, st.geometry)
    }
  }

  const paintHighlight = (mode, controlIndices = selectedRef.current) => {
    const st = stateRef.current
    if (!st.geometry || !st.mesh) return

    const paintMode = meshViewModeRef.current === 'gray_pick' ? 'control_pick' : mode

    const headVertexCount = resolveViewerHeadCount(st)

    const payload = {
      headVertexCount,
      meshVertexStarts: st.meshVertexStarts,
      numVertices: st.numVertices,
      serveLod: RIGLOGIC_LOD,
    }
    if (paintMode === 'identity_uv' || paintMode === 'uv_mouth') {
      payload.regionUvTexture = st.regionUvTexture
    }
    if (paintMode === 'uv_mouth' && st.uvMouth) {
      payload.lip = st.uvMouth.lip
      payload.mouth = st.uvMouth.mouth
    }
    if (paintMode === 'lip_mask' || paintMode === 'lip_mask_single') {
      payload.lipMask = st.lipMask
      payload.lipMaskSingleColor = paintMode === 'lip_mask_single'
    }
    if (paintMode === 'mouth_region_mask') {
      payload.mouthRegionMask = st.mouthRegionMask
    }
    if (paintMode === 'lower_face_mask') {
      payload.lowerFaceMask = st.lowerFaceMask
    }
    if (paintMode === 'dna_wm_masks' && st.dnaWmMaskBundle) {
      payload.dnaWmMaskBundle = {
        ...st.dnaWmMaskBundle,
        selection: dnaWmMaskPickRef.current,
      }
    }
    if (paintMode === 'control' && controlIndices?.length && controlDeltasRef.current?.deltas) {
      payload.vertexDeltas = controlDeltasRef.current.deltas
      payload.minDeltaCm = minDeltaRef.current
      payload.maxDeltaCm = controlDeltasRef.current.maxCm
    }
    if (paintMode === 'control_pick') {
      const deltas = controlDeltasRef.current?.deltas
      if (deltas?.length) {
        payload.vertexDeltas = deltas
        payload.minDeltaCm = minDeltaRef.current
        payload.maxDeltaCm = controlDeltasRef.current.maxCm
        setPickVertCount(countAboveThreshold(deltas, minDeltaRef.current))
      } else if (st.controlVerts && controlIndices?.length) {
        const ids = unionVertsForGuiControls(st.controlVerts, controlIndices, headVertexCount)
        payload.activeIds = new Set(ids)
        setPickVertCount(ids.length)
      } else {
        setPickVertCount(0)
      }
    }
    const highlightMode = paintMode === 'lip_mask_single' ? 'lip_mask' : paintMode
    const baseMaterials = st.mesh?.userData._baseMaterials || st.material
    const result = applyVertexHighlight(st.mesh, st.geometry, baseMaterials, highlightMode, payload)
    if (result?.material) {
      st.material = result.material
      st.mesh.material = result.material
    }
    if (highlightMode === 'identity_uv') {
      setRegionDiag({ ...(result?.diag || {}), serveBase: serverBase, geoLod: RIGLOGIC_LOD })
      setUvMouthDiag(null)
      setMaskDiag(null)
    } else if (highlightMode === 'uv_mouth') {
      setRegionDiag(null)
      setUvMouthDiag({ ...(result?.diag || {}), geoLod: RIGLOGIC_LOD })
      setMaskDiag(null)
    } else if (highlightMode === 'lip_mask' || highlightMode === 'mouth_region_mask'
      || highlightMode === 'lower_face_mask' || highlightMode === 'dna_wm_masks') {
      setRegionDiag(null)
      setUvMouthDiag(null)
      updateMaskDiag(setMaskDiag, result?.diag, RIGLOGIC_LOD)
    } else {
      setRegionDiag(null)
      setUvMouthDiag(null)
      setMaskDiag(null)
    }
    if (st.scene) {
      st.scene.background = new THREE.Color(
        highlightMode === 'identity_uv' || highlightMode === 'uv_mouth' ? 0xd4c4e8 : 0x1a1d24,
      )
    }
  }

  const send = async () => {
    const ev = evalRef.current
    const st = stateRef.current
    ev.inFlight = true
    ev.dirty = false
    try {
      if (!st.deformAssets || !st.deformOut) return
      const resp = await fetch('/api/riglogic/eval_gui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: valuesRef.current }),
        cache: 'no-store',
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}))
        throw new Error(j.error || `eval_gui HTTP ${resp.status}`)
      }
      const buf = await resp.arrayBuffer()
      const frame = parseEvalRigFrame(buf)
      deformFrame(st.deformAssets, frame.bs, frame.jo, st.deformOut)
      applyVertices(st.deformOut)
      const mode = highlightRef.current
      if (highlightNeedsRepaintAfterEval(mode)) {
        paintHighlight(mode, selectedRef.current)
      }
    } catch {}
    ev.inFlight = false
    if (ev.dirty) send()
  }

  const evaluate = () => {
    const ev = evalRef.current
    if (ev.inFlight) { ev.dirty = true; return }
    send()
  }

  useEffect(() => {
    let cancelled = false
    async function syncHighlight() {
      if (vertexHighlight === 'dna_wm_masks') {
        const bundle = await ensureDnaWmMaskBundle(
          stateRef.current, serverBase, setDnaWmMaskLoadStatus,
        )
        if (cancelled) return
        if (!bundle) {
          setMaskDiag({
            error: 'DNA WM mask 로드 실패 — export_dna_wm_mask_manifest.py 및 serve.py 확인',
            geoLod: RIGLOGIC_LOD,
          })
          return
        }
        setDnaWmMaskList(bundle.manifest?.masks || [])
      }
      if (VERTEX_MASK_MODES.has(vertexHighlight)) {
        await ensureVertexMaskLoaded(vertexHighlight, stateRef.current, serverBase)
        if (cancelled) return
      }
      paintHighlight(vertexHighlight, selectedControls)
    }
    syncHighlight()
    return () => { cancelled = true }
  }, [vertexHighlight, dnaWmMaskPick, regionUvReady, selectedControls, meshViewMode, serverBase, status])

  useEffect(() => {
    if (vertexHighlight !== 'dna_wm_masks') return
    paintHighlight('dna_wm_masks', selectedControls)
  }, [dnaWmMaskPick, vertexHighlight, selectedControls])

  useEffect(() => {
    let cancelled = false
    async function refreshDeltas() {
      const grayPick = meshViewModeRef.current === 'gray_pick'
      const controlDebug = vertexHighlight === 'control'
      const needsDeltas = grayPick || controlDebug

      if (!needsDeltas || !selectedControls.length) {
        controlDeltasRef.current = null
        setDeltaMeta(null)
        if (grayPick) setPickVertCount(0)
        return
      }

      const data = await fetchControlDeltas(selectedControls)
      if (cancelled) return
      controlDeltasRef.current = data
      if (data?.deltas) {
        const count = countAboveThreshold(data.deltas, minDeltaRef.current)
        setDeltaMeta({ maxCm: data.maxCm, count })
        setPickVertCount(grayPick ? count : 0)
        paintHighlight(vertexHighlight, selectedControls)
      } else {
        controlDeltasRef.current = null
        setDeltaMeta(null)
        if (grayPick) paintHighlight(vertexHighlight, selectedControls)
      }
    }
    refreshDeltas()
    return () => { cancelled = true }
  }, [selectedControls, vertexHighlight, serverBase, meshViewMode])

  const addControlToSelection = (index) => {
    setSelectedControls((prev) => (prev.includes(index) ? prev : [...prev, index]))
  }

  const toggleControlSelection = (index) => {
    setSelectedControls((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    )
  }

  const pickControl = (c, e) => {
    e?.preventDefault()
    toggleControlSelection(c.index)
  }

  const onSlider = (index, value) => {
    if (!valuesRef.current) return
    valuesRef.current[index] = value
    setValueTick((t) => t + 1)
    addControlToSelection(index)
    evaluate()
  }

  const resetAll = () => {
    if (!valuesRef.current) return
    valuesRef.current = valuesRef.current.map(() => 0)
    setResetTick((t) => t + 1)
    setValueTick((t) => t + 1)
    evaluate()
  }

  const grouped = useMemo(() => {
    const by = {}
    controls.forEach((c) => {
      ;(by[c.region] = by[c.region] || []).push(c)
    })
    const order = [...REGION_ORDER.filter((r) => by[r]), ...Object.keys(by).filter((r) => !REGION_ORDER.includes(r))]
    return order.map((r) => [r, by[r]])
  }, [controls])

  const shortName = (n) => n.replace(/^CTRL_/, '').replace(/\.(tx|ty)$/, (m) => (m === '.tx' ? ' ↔' : ''))

  const selectedSet = useMemo(() => new Set(selectedControls), [selectedControls])

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="text-sm font-semibold text-gray-100">MetaHuman GUI</span>
        <span className="text-xs text-gray-500">{controls.length || 174} controls</span>
        <span className="text-[11px] text-gray-500">{status}</span>
        {status !== 'ready' && (
          <span className="text-[10px] text-amber-400">
            serve.py(8765) 필요
          </span>
        )}
        <div className="ml-auto flex rounded overflow-hidden border border-white/15 text-[10px]">
          <button
            type="button"
            onClick={() => setMeshViewMode('texture')}
            className={`px-2 py-0.5 ${meshViewMode === 'texture' ? 'bg-emerald-700 text-white' : 'bg-white/5 text-gray-400'}`}
            title="피부 텍스처"
          >
            텍스처
          </button>
          <button
            type="button"
            onClick={() => setMeshViewMode('gray_pick')}
            className={`px-2 py-0.5 ${meshViewMode === 'gray_pick' ? 'bg-emerald-700 text-white' : 'bg-white/5 text-gray-400'}`}
            title="회색 메시 + 선택 컨트롤 영역 하이라이트"
          >
            회색·선택
          </button>
        </div>
        <div className="flex rounded overflow-hidden border border-white/15 text-[10px]">
          <button
            type="button"
            onClick={() => setPanelMode('faceboard')}
            className={`px-2 py-0.5 ${panelMode === 'faceboard' ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400'}`}
          >
            Face Board
          </button>
          <button
            type="button"
            onClick={() => setPanelMode('list')}
            className={`px-2 py-0.5 ${panelMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}
          >
            목록
          </button>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="px-2.5 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-gray-200"
        >
          초기화
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={mountRef} className="relative w-1/2 min-w-0 border-r border-white/10 bg-[#1a1d24]">
          {status !== 'ready' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#1a1d24]/90 p-6 text-center">
              <div className="text-sm text-gray-300 space-y-2">
                <p>{status}</p>
                <p className="text-xs text-gray-500">
                  터미널에서 <code className="text-amber-300">python serve.py</code>
                  {' '}(e:\Viewer\riglogic_py, 포트 8765)
                </p>
              </div>
            </div>
          )}
          {meshViewMode === 'gray_pick' && (
            <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/50 px-2 py-1 text-[10px] text-gray-300">
              회색 메시
              {selectedControls.length > 0
                ? ` · ${selectedControls.length} ctrl · ${pickVertCount} verts`
                : ' · Face Board에서 컨트롤 선택'}
            </div>
          )}
          {VERTEX_MASK_MODES.has(vertexHighlight) && (
            <div className={`pointer-events-none absolute left-2 top-2 z-10 rounded px-2 py-1 text-[10px] ${
              maskDiag?.error ? 'bg-red-900/80 text-red-200' : 'bg-black/60 text-gray-200'
            }`}>
              {maskDiag?.error
                ? maskDiag.error
                : maskDiag?.ok
                  ? `${vertexHighlight === 'mouth_region_mask'
                    ? 'Mouth region'
                    : vertexHighlight === 'lower_face_mask'
                      ? 'Lower face'
                      : vertexHighlight === 'dna_wm_masks'
                        ? 'DNA WM TGA'
                        : 'LVE lip mask'} · ${maskDiag.paintedVerts ?? maskDiag.vertexCount ?? maskDiag.allLipCount ?? '?'} verts · LOD${RIGLOGIC_LOD}`
                  : dnaWmMaskLoadStatus || 'vertex mask 로딩 중…'}
            </div>
          )}
        </div>

        <div className="flex w-1/2 min-w-0 flex-col min-h-0">
          {panelMode === 'faceboard' && controls.length > 0 ? (
            <>
              <div className="min-h-0 flex-1 p-3">
                <FaceBoardPanel
                  controls={controls}
                  valuesRef={valuesRef}
                  valueTick={valueTick}
                  selectedControls={selectedControls}
                  resetTick={resetTick}
                  onControlChange={onSlider}
                  onSelect={toggleControlSelection}
                />
              </div>
              {selectedControls.length > 0 && (
                <div className="max-h-[28%] shrink-0 overflow-y-auto border-t border-white/10 px-3 py-2 text-gray-200">
                  <p className="text-[10px] text-gray-500 mb-2 sticky top-0 bg-gray-900 py-1">
                    선택된 컨트롤 미세 조정
                  </p>
                  <div className="space-y-1.5">
                    {controls.filter((c) => selectedSet.has(c.index)).map((c) => (
                      <div key={c.index} className="flex items-center gap-2 rounded px-1 py-0.5 bg-cyan-500/10 ring-1 ring-cyan-400/30">
                        <span className="text-[11px] text-gray-400 w-[140px] truncate">{shortName(c.name)}</span>
                        <input
                          key={`${c.index}-${resetTick}`}
                          type="range"
                          min={c.min}
                          max={c.max}
                          step={0.01}
                          defaultValue={0}
                          onInput={(e) => onSlider(c.index, Number(e.target.value))}
                          className="flex-1 accent-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : panelMode === 'faceboard' ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              serve.py 연결 후 Face Board가 표시됩니다.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-3 py-2 text-gray-200 min-h-0">
              {grouped.map(([region, items]) => (
                <details key={region} open={region === 'jaw' || region === 'mouth'} className="mb-1.5">
                  <summary className="cursor-pointer text-xs font-semibold text-blue-300 py-1 select-none">
                    {REGION_LABEL[region] || region} ({items.length})
                  </summary>
                  <div className="pl-1 pt-1 space-y-1.5">
                    {items.map((c) => (
                      <div
                        key={c.index}
                        className={`flex items-center gap-2 rounded px-1 py-0.5 -mx-1 ${
                          selectedSet.has(c.index)
                            ? 'bg-cyan-500/15 ring-1 ring-cyan-400/40'
                            : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => pickControl(c, e)}
                          className="text-[11px] text-gray-400 w-[150px] truncate text-left hover:text-cyan-200"
                          title={`${c.name} (클릭: 선택 토글)`}
                        >
                          {shortName(c.name)}
                        </button>
                        <input
                          key={`${c.index}-${resetTick}`}
                          type="range"
                          min={c.min}
                          max={c.max}
                          step={0.01}
                          defaultValue={0}
                          onFocus={() => addControlToSelection(c.index)}
                          onInput={(e) => onSlider(c.index, Number(e.target.value))}
                          className="flex-1 accent-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          <details
            className="shrink-0 border-t border-white/5 px-3 py-2"
            open
          >
            <summary className="text-[11px] text-gray-400 cursor-pointer select-none">
              정점 하이라이트 (디버그){meshViewMode === 'gray_pick' ? ' — 회색·선택 모드에서는 비활성' : ''}
            </summary>
            <div className="pt-2 space-y-1">
              <select
                value={vertexHighlight}
                disabled={meshViewMode === 'gray_pick'}
                onChange={(e) => setVertexHighlight(e.target.value)}
                className="w-full text-xs bg-gray-800 border border-white/10 rounded px-2 py-1 text-gray-200 disabled:opacity-40"
              >
                <option value="off">텍스처 (기본)</option>
                <option value="control">선택 컨트롤 변위 (디버그)</option>
                <option value="uv_mouth">UV 입·입술 (CSV 검증)</option>
                <option value="identity_uv">Identity UV (T_Gray_Head_D)</option>
                <option value="lip_mask">LVE Lip Mask (LOD0, subgroup)</option>
                <option value="lip_mask_single">LVE Lip Mask (LOD0, 단일색)</option>
                <option value="mouth_region_mask">Mouth Region Mask (LOD0)</option>
                <option value="lower_face_mask">Lower Face Mask (LOD0)</option>
                <option value="dna_wm_masks">DNA WM Mask TGA (Epic 원본, UV wrap)</option>
              </select>
              {vertexHighlight === 'control' && deltaMeta && (
                <p className="text-[10px] text-gray-500 pt-1">
                  변위 ≥ {minDeltaRef.current}cm: {deltaMeta.count} verts · max {deltaMeta.maxCm?.toFixed(2)}cm
                </p>
              )}
              {vertexHighlight === 'uv_mouth' && (
                <p className="text-[10px] text-gray-500 pt-1 leading-relaxed">
                  T_Gray_Head_D 빨간 테두리(lip stroke) UV만.
                  {' '}lip {uvMouthDiag?.lipCount ?? '?'} · mouth {uvMouthDiag?.mouthCount ?? '?'}
                  {uvMouthDiag?.csvMatch === true && (
                    <span className="text-emerald-400"> · CSV id 일치</span>
                  )}
                  {uvMouthDiag?.csvMatch === false && (
                    <span className="text-amber-400">
                      {' '}· CSV diff lip±{((uvMouthDiag.csvDiff?.lipOnlyInCsv ?? 0) + (uvMouthDiag.csvDiff?.lipOnlyInUv ?? 0))}
                      /mouth±{((uvMouthDiag.csvDiff?.mouthOnlyInCsv ?? 0) + (uvMouthDiag.csvDiff?.mouthOnlyInUv ?? 0))}
                    </span>
                  )}
                  {uvMouthDiag?.error && (
                    <span className="text-amber-400 block pt-0.5">{uvMouthDiag.error}</span>
                  )}
                </p>
              )}
              {vertexHighlight === 'identity_uv' && (
                <p className="text-[10px] text-gray-500 pt-1 leading-relaxed">
                  T_Gray_Head_D UV id map 미리보기
                  {!regionUvReady && (
                    <span className="text-amber-400 block pt-0.5">텍스처 로드 실패 — FaceTool 새로고침</span>
                  )}
                </p>
              )}
              {(vertexHighlight === 'lip_mask' || vertexHighlight === 'lip_mask_single') && (
                <div className="text-[10px] text-gray-500 pt-1 leading-relaxed">
                  <p>
                    MH-LVE-LIP-v1 · metahuman_head_lod0_lip_mask.json
                    {maskDiag?.allLipCount != null && (
                      <span className="text-gray-300"> · all_lip {maskDiag.allLipCount} verts</span>
                    )}
                    {maskDiag?.vertexCount != null && maskDiag?.allLipCount == null && (
                      <span className="text-gray-300"> · {maskDiag.vertexCount} verts</span>
                    )}
                  </p>
                  {vertexHighlight === 'lip_mask' && maskDiag?.groupCounts && (
                    <p className="pt-0.5 font-mono">
                      <span style={{ color: '#e64019' }}>■</span> up_out {maskDiag.groupCounts.upper_outer_lip}
                      {' '}<span style={{ color: '#2673f2' }}>■</span> lo_out {maskDiag.groupCounts.lower_outer_lip}
                      <br />
                      <span style={{ color: '#f2c719' }}>■</span> up_in {maskDiag.groupCounts.upper_inner_lip}
                      {' '}<span style={{ color: '#26cc66' }}>■</span> lo_in {maskDiag.groupCounts.lower_inner_lip}
                      <br />
                      <span style={{ color: '#cc26cc' }}>■</span> corner_L {maskDiag.groupCounts.left_mouth_corner}
                      {' '}<span style={{ color: '#0dc7c7' }}>■</span> corner_R {maskDiag.groupCounts.right_mouth_corner}
                    </p>
                  )}
                  <p className="pt-0.5">컨트롤 슬라이더를 움직여 deformation 상태에서도 mask 추적을 확인할 수 있습니다.</p>
                  {maskDiag?.error && (
                    <span className="text-amber-400 block pt-0.5">{maskDiag.error}</span>
                  )}
                </div>
              )}
              {vertexHighlight === 'mouth_region_mask' && (
                <div className="text-[10px] text-gray-500 pt-1 leading-relaxed">
                  <p>
                    MH-LVE-MOUTHREGION-v1 · metahuman_head_lod0_mouth_region_mask.json
                    {maskDiag?.vertexCount != null && (
                      <span className="text-gray-300"> · {maskDiag.vertexCount} verts</span>
                    )}
                  </p>
                  <p className="pt-0.5">입술·입꼬리·인중 하단·perioral skin (lip mask 1.0cm 팽창)</p>
                  {maskDiag?.error && (
                    <span className="text-amber-400 block pt-0.5">{maskDiag.error}</span>
                  )}
                </div>
              )}
              {vertexHighlight === 'lower_face_mask' && (
                <div className="text-[10px] text-gray-500 pt-1 leading-relaxed">
                  <p>
                    MH-LVE-LOWERFACE-v1 · metahuman_head_lod0_lower_face_mask.json
                    {maskDiag?.vertexCount != null && (
                      <span className="text-gray-300"> · {maskDiag.vertexCount} verts</span>
                    )}
                  </p>
                  <p className="pt-0.5">mouth region ∪ jaw displacement 지원 영역</p>
                  {maskDiag?.error && (
                    <span className="text-amber-400 block pt-0.5">{maskDiag.error}</span>
                  )}
                </div>
              )}
              {vertexHighlight === 'dna_wm_masks' && (
                <div className="text-[10px] text-gray-500 pt-1 leading-relaxed space-y-1.5">
                  <p>
                    Epic <code className="text-gray-400">SourceAssets/masks</code> TGA → head_lod0_mesh UV
                    {maskDiag?.paintedVerts != null && (
                      <span className="text-gray-300"> · {maskDiag.paintedVerts} verts painted</span>
                    )}
                  </p>
                  <p className="text-gray-400">
                    DNA wrap: TGA <code>_msk.tga</code> = animated_map
                    {' '}<code>{'{material}.{mask_id}'}</code>
                    {' '}(예: head_cm1_color.head_wm13_lips_UL)
                  </p>
                  {dnaWmMaskLoadStatus && (
                    <p className="text-amber-300">{dnaWmMaskLoadStatus}</p>
                  )}
                  <select
                    value={dnaWmMaskPick}
                    onChange={(e) => setDnaWmMaskPick(e.target.value)}
                    className="w-full text-xs bg-gray-800 border border-white/10 rounded px-2 py-1 text-gray-200"
                  >
                    <option value="all">전체 (37색, max-weight)</option>
                    {dnaWmMaskList.map((m) => (
                      <option key={m.file} value={m.mask_id}>{m.mask_id}</option>
                    ))}
                  </select>
                  {dnaWmMaskPick === 'all' && dnaWmMaskList.length > 0 && (
                    <div className="max-h-32 overflow-y-auto font-mono text-[9px] leading-relaxed border border-white/10 rounded p-1">
                      {dnaWmMaskList.map((m) => {
                        const c = dnaWmMaskColor(m.index, dnaWmMaskList.length)
                        const hex = `#${c.getHexString()}`
                        const n = maskDiag?.perMaskCounts?.[m.mask_id]
                        return (
                          <div key={m.file} className="truncate">
                            <span style={{ color: hex }}>■</span>
                            {' '}{m.mask_id}
                            {n != null && <span className="text-gray-500"> · {n}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {maskDiag?.error && (
                    <span className="text-amber-400 block pt-0.5">{maskDiag.error}</span>
                  )}
                </div>
              )}
              {vertexHighlight === 'identity_uv' && regionDiag && (
                <p className="text-[10px] text-gray-400 pt-1 font-mono leading-relaxed">
                  LOD serve={regionDiag.geoLod ?? '?'} · head={regionDiag.headVertexCount ?? '?'}
                  {regionDiag.error ? (
                    <>
                      <br />
                      <span className="text-amber-400">{regionDiag.error}</span>
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
