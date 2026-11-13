'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RIGLOGIC_LOD } from '../lib/riglogicLod'
import {
  addRiglogicThreePointLighting,
  configureRiglogicRenderer,
} from '../lib/riglogicSceneLighting'
import FaceCreatorControlPanel, { defaultSculptFeatures } from './FaceCreatorControlPanel'

const DEFAULT_APPEARANCE = {
  tintR: 1,
  tintG: 1,
  tintB: 1,
  brightness: 1,
}

const MALE_ID = 'man'
const FEMALE_ID = '0421_V33'

function isHeadMaterialName(name) {
  const s = (name || '').toLowerCase()
  return s.startsWith('head')
}

/**
 * MetaHuman 얼굴 편집 — Identity 부위 스컬프트 + 표정 + 피부색.
 */
export default function FaceCreatorViewer({ serverBase: serverBaseProp, dnaProfileId = '' }) {
  const [serverBase, setServerBase] = useState(serverBaseProp || 'http://localhost:8765')
  useEffect(() => {
    if (serverBaseProp) return
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [serverBaseProp])

  const mountRef = useRef(null)
  const stateRef = useRef({})
  const valuesRef = useRef(null)
  const evalRef = useRef({ inFlight: false, dirty: false })
  const appearanceRef = useRef({ ...DEFAULT_APPEARANCE })
  const sculptRef = useRef(defaultSculptFeatures())

  const [status, setStatus] = useState('연결 중...')
  const [controls, setControls] = useState([])
  const [appearance, setAppearance] = useState({ ...DEFAULT_APPEARANCE })
  const [sculptFeatures, setSculptFeatures] = useState(() => defaultSculptFeatures())
  const [valueTick, setValueTick] = useState(0)
  const [resetTick, setResetTick] = useState(0)
  const [pairOk, setPairOk] = useState(true)

  const applySkinTint = useCallback(() => {
    const st = stateRef.current
    const mats = st.mesh?.material
    if (!mats) return
    const a = appearanceRef.current
    const list = Array.isArray(mats) ? mats : [mats]
    const groups = st.geoGroups || []
    list.forEach((m, i) => {
      const name = groups[i]?.name || ''
      if (!isHeadMaterialName(name) && groups.length > 1) return
      m.color.setRGB(
        a.tintR * a.brightness,
        a.tintG * a.brightness,
        a.tintB * a.brightness,
      )
      m.needsUpdate = true
    })
  }, [])

  const applyVertices = useCallback((arr) => {
    const st = stateRef.current
    if (!st.geometry) return
    const pos = st.geometry.attributes.position.array
    const n = Math.min(pos.length, arr.length)
    pos.set(arr.subarray(0, n))
    st.geometry.attributes.position.needsUpdate = true
    st.geometry.computeVertexNormals()
  }, [])

  const evaluateRef = useRef(() => {})
  evaluateRef.current = () => {
    const ev = evalRef.current
    if (ev.inFlight) {
      ev.dirty = true
      return
    }
    const run = async () => {
      const st = stateRef.current
      ev.inFlight = true
      ev.dirty = false
      try {
        if (!valuesRef.current || !st.numVertices) return
        const resp = await fetch('/api/riglogic/eval_gui_blend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: valuesRef.current,
            features: sculptRef.current,
            overall: 0,
            male: MALE_ID,
            female: FEMALE_ID,
          }),
          cache: 'no-store',
        })
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}))
          throw new Error(j.error || `eval_gui_blend HTTP ${resp.status}`)
        }
        const buf = await resp.arrayBuffer()
        const verts = new Float32Array(buf)
        if (verts.length < st.numVertices * 3) {
          throw new Error(`vertex buffer short: ${verts.length} < ${st.numVertices * 3}`)
        }
        applyVertices(verts)
      } catch (e) {
        console.warn('[FaceCreator]', e.message || e)
      } finally {
        ev.inFlight = false
        if (ev.dirty) evaluateRef.current()
      }
    }
    run()
  }

  const evaluate = useCallback(() => {
    evaluateRef.current()
  }, [])

  // three.js scene
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
      if (!w || !h) return
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

  // load geo (topology/textures from selected DNA) + gui
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

        const pairRes = await fetch('/api/riglogic/eval_gui_blend')
        if (!pairRes.ok) {
          const j = await pairRes.json().catch(() => ({}))
          throw new Error(j.error || `identity_pair HTTP ${pairRes.status}`)
        }
        const pair = await pairRes.json()
        if (!cancelled) {
          setPairOk(pair.compatible !== false)
          if (pair.compatible === false) {
            setStatus('남자/여자 DNA 정점 수가 달라 블렌드 불가')
            return
          }
        }

        const geoRes = await fetch(u('/geo'))
        if (!geoRes.ok) throw new Error(`geo HTTP ${geoRes.status} — serve.py(8765) 확인`)
        const guiRes = await fetch(u('/gui'))
        if (!guiRes.ok) throw new Error(`gui HTTP ${guiRes.status}`)
        const geo = await geoRes.json()
        const gui = await guiRes.json()
        if (cancelled) return
        if (geo.lod != null && geo.lod !== RIGLOGIC_LOD) {
          console.warn(`[FaceCreator] serve LOD ${geo.lod} != ${RIGLOGIC_LOD}`)
        }
        st.headVertexCount = geo.headVertexCount ?? geo.meshVertexStarts?.[1]
        st.geoGroups = geo.groups || []
        st.numVertices = geo.numVertices

        const [idxBuf, uvBuf] = await Promise.all([
          fetch(u(geo.indicesUrl)).then(async (r) => {
            if (!r.ok) throw new Error(`indices HTTP ${r.status}`)
            return r.arrayBuffer()
          }),
          fetch(u(geo.uvsUrl)).then(async (r) => {
            if (!r.ok) throw new Error(`uvs HTTP ${r.status}`)
            return r.arrayBuffer()
          }),
        ])
        if (cancelled) return
        if (!st.scene) throw new Error('3D 씬이 아직 준비되지 않음')
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
              t.flipY = true
              t.colorSpace = cs
              t.anisotropy = 8
              resolve(t)
            }, undefined, () => resolve(null))
          })

        const roughnessFor = (n) => {
          const s = (n || '').toLowerCase()
          if (s.startsWith('eyeleft') || s.startsWith('eyeright')) return 0.18
          if (s.startsWith('teeth')) return 0.38
          return 0.62
        }
        const makeMaterial = (tex, name) => {
          const m = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: roughnessFor(name),
            metalness: 0,
          })
          if (tex?.map) {
            loadTex(tex.map, THREE.SRGBColorSpace).then((t) => {
              if (!cancelled && t) {
                m.map = t
                m.needsUpdate = true
              }
            })
          }
          if (tex?.normalMap) {
            loadTex(tex.normalMap, THREE.NoColorSpace).then((t) => {
              if (!cancelled && t) {
                m.normalMap = t
                m.needsUpdate = true
              }
            })
          }
          return m
        }

        let material
        if (geo.groups?.length) {
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

        valuesRef.current = new Array(gui.count).fill(0)
        sculptRef.current = defaultSculptFeatures()
        setSculptFeatures(defaultSculptFeatures())
        setControls(gui.controls || [])
        appearanceRef.current = { ...DEFAULT_APPEARANCE }
        setAppearance({ ...DEFAULT_APPEARANCE })
        setStatus('ready')
        applySkinTint()
        evaluateRef.current()
      } catch (e) {
        if (!cancelled) setStatus(`오류: ${e.message}`)
      }
    }
    load()
    return () => {
      cancelled = true
      disposeMesh()
    }
  }, [serverBase, dnaProfileId, applySkinTint])

  const onAppearanceChange = (key, value) => {
    appearanceRef.current = { ...appearanceRef.current, [key]: value }
    setAppearance({ ...appearanceRef.current })
    applySkinTint()
  }

  const onSculptFeatureChange = (id, value) => {
    const next = { ...sculptRef.current, [id]: value }
    sculptRef.current = next
    setSculptFeatures(next)
    evaluate()
  }

  const onSculptAll = (value) => {
    const next = defaultSculptFeatures()
    for (const k of Object.keys(next)) next[k] = value
    sculptRef.current = next
    setSculptFeatures(next)
    evaluate()
  }

  const onSculptReset = () => {
    const next = defaultSculptFeatures()
    sculptRef.current = next
    setSculptFeatures(next)
    evaluate()
  }

  const onControlChange = (index, value) => {
    if (!valuesRef.current) return
    valuesRef.current[index] = value
    setValueTick((n) => n + 1)
    evaluate()
  }

  const onExprReset = () => {
    if (!valuesRef.current) return
    valuesRef.current = valuesRef.current.map(() => 0)
    setResetTick((n) => n + 1)
    setValueTick((n) => n + 1)
    evaluate()
  }

  const onResetAll = () => {
    appearanceRef.current = { ...DEFAULT_APPEARANCE }
    setAppearance({ ...DEFAULT_APPEARANCE })
    applySkinTint()
    onSculptReset()
    onExprReset()
  }

  const avg = Object.values(sculptFeatures).reduce((a, b) => a + b, 0)
    / Math.max(1, Object.keys(sculptFeatures).length)
  const blendLabel = avg < 0.15
    ? '남자형'
    : avg > 0.85
      ? '여자형'
      : `커스텀 ${Math.round(avg * 100)}%`

  return (
    <div className="flex h-full min-h-0 bg-gray-900">
      <div className="flex w-[380px] shrink-0 flex-col min-h-0">
        <FaceCreatorControlPanel
          appearance={appearance}
          onAppearanceChange={onAppearanceChange}
          sculptFeatures={sculptFeatures}
          onSculptFeatureChange={onSculptFeatureChange}
          onSculptAll={onSculptAll}
          onSculptReset={onSculptReset}
          controls={controls}
          valuesRef={valuesRef}
          valueTick={valueTick}
          resetTick={resetTick}
          onControlChange={onControlChange}
          onExprReset={onExprReset}
          onResetAll={onResetAll}
        />
      </div>

      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={mountRef} className="absolute inset-0 bg-[#1a1d24]" />
        {status !== 'ready' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#1a1d24]/90 p-6 text-center">
            <div className="space-y-2 text-sm text-gray-300">
              <p>{status}</p>
              {String(status).startsWith('오류') && (
                <p className="text-xs text-gray-500">
                  serve.py가 8765에서 실행 중인지 확인하세요
                </p>
              )}
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-black/55 px-2 py-1 text-[10px] text-gray-200">
          {blendLabel} · 표정 {controls.length || '—'}
          {!pairOk ? ' · 블렌드 불가' : ''}
        </div>
      </div>
    </div>
  )
}
