'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { parseDeformStatic, parseEvalRigBatch } from '../../lib/loadDeformStatic'
import { deformFrame } from '../../lib/riglogicDeform'
import {
  addRiglogicThreePointLighting,
  configureRiglogicRenderer,
} from '../../lib/riglogicSceneLighting'

const RIG_BATCH = 120

function rowsFromInferenceData(data, blendshapes) {
  return data.map((row) =>
    Array.isArray(row) ? row : blendshapes.map((name) => row[name] ?? 0),
  )
}

function waitForScene(st, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (st.scene && st.renderer && st.camera) {
        resolve()
        return
      }
      if (Date.now() - t0 > timeoutMs) {
        reject(new Error('Three.js scene init timeout'))
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

async function fetchEvalRigBatch(columns, rows) {
  const resp = await fetch('/api/riglogic/eval_rig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns, rows }),
    cache: 'no-store',
  })
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}))
    throw new Error(j.error || `eval_rig HTTP ${resp.status}`)
  }
  return parseEvalRigBatch(await resp.arrayBuffer())
}

/**
 * MetaHuman inference playback — browser-side deform.
 */
export default function ServiceRigLogicViewer({
  inferenceKey = '',
  blendshapes = [],
  data = [],
  currentFrame = 0,
  playbackFrameRef = null,
  serverBase = 'http://localhost:8765',
}) {
  const mountRef = useRef(null)
  const stateRef = useRef({})
  const rigRef = useRef({ frames: [], assets: null, out: null })
  const currentFrameRef = useRef(currentFrame)
  const playbackFrameRefRef = useRef(playbackFrameRef)
  const lastAppliedRef = useRef(-1)
  const applyFrameRef = useRef(() => {})
  const [status, setStatus] = useState('idle')
  const [loadProgress, setLoadProgress] = useState(null)

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    playbackFrameRefRef.current = playbackFrameRef
  }, [playbackFrameRef])

  function readPlaybackFrame() {
    const ref = playbackFrameRefRef.current
    if (ref) return ref.current
    return currentFrameRef.current
  }

  function applyFrame(fi) {
    const st = stateRef.current
    const rig = rigRef.current
    if (!st.geometry || !rig.assets || !rig.frames.length) return false
    const idx = Math.max(0, Math.min(fi, rig.frames.length - 1))
    const frame = rig.frames[idx]
    if (!frame) return false
    if (!rig.out || rig.out.length !== rig.assets.V * 3) {
      rig.out = new Float32Array(rig.assets.V * 3)
    }
    deformFrame(rig.assets, frame.bs, frame.jo, rig.out)
    const attr = st.geometry.getAttribute('position')
    if (!attr || rig.out.length !== attr.count * 3) return false
    attr.array.set(rig.out)
    attr.needsUpdate = true
    st.renderer?.render(st.scene, st.camera)
    return true
  }
  applyFrameRef.current = applyFrame

  // three.js scene (once)
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1d24)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000)
    camera.position.set(0, 0, 80)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    configureRiglogicRenderer(renderer, THREE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    const lights = addRiglogicThreePointLighting(scene, THREE)

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w <= 0 || h <= 0) return
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
      controls.update()
      const rig = rigRef.current
      if (rig.assets && rig.frames.length) {
        const fi = playbackFrameRefRef.current
          ? playbackFrameRefRef.current.current
          : currentFrameRef.current
        if (fi !== lastAppliedRef.current) {
          lastAppliedRef.current = fi
          applyFrameRef.current(fi)
        }
      }
      renderer.render(scene, camera)
    }
    animate()
    Object.assign(stateRef.current, { scene, camera, renderer, controls, lights })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      stateRef.current.scene = null
      stateRef.current.renderer = null
    }
  }, [])

  // geometry + rig batch + deform static
  useEffect(() => {
    if (!inferenceKey || !blendshapes.length || !data.length) return undefined

    let cancelled = false
    const st = stateRef.current
    const rig = rigRef.current
    const u = (p) => `${serverBase}${p}`
    const rows = rowsFromInferenceData(data, blendshapes)

    rig.frames = []
    rig.assets = null
    rig.out = null
    lastAppliedRef.current = -1
    setLoadProgress(null)

    async function load() {
      try {
        setStatus('RigLogic 연결 중...')
        await waitForScene(st)
        if (cancelled) return

        const healthRes = await fetch('/api/riglogic/eval_rig')
        if (!healthRes.ok) throw new Error('eval_rig API unavailable')
        const health = await healthRes.json()
        if (!health?.available) {
          throw new Error(
            'serve.py 구버전 — GET /deform_static + POST /eval_rig/batch 필요. python serve.py 재실행',
          )
        }

        const geo = await fetch(u('/geo')).then((r) => r.json())
        if (cancelled) return
        if (geo.error) throw new Error(geo.error)

        setStatus('deform static 로드...')
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

        rig.assets = parseDeformStatic(staticBuf)
        if (rig.assets.V !== geo.numVertices) {
          throw new Error(
            `vertex count mismatch: geo=${geo.numVertices} static=${rig.assets.V}`,
          )
        }

        if (st.mesh) {
          st.scene.remove(st.mesh)
          st.geometry?.dispose()
          const mats = Array.isArray(st.material) ? st.material : [st.material]
          mats.forEach((m) => {
            if (m?.map) m.map.dispose()
            m?.dispose()
          })
          st.mesh = null
        }

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
            loader.load(
              u(`/texture?name=${name}`),
              (t) => {
                t.flipY = true
                t.colorSpace = cs
                t.anisotropy = 8
                resolve(t)
              },
              undefined,
              () => resolve(null),
            )
          })
        const roughnessFor = (name) => {
          const n = (name || '').toLowerCase()
          if (n.startsWith('eyeleft') || n.startsWith('eyeright')) return 0.18
          if (n.startsWith('teeth')) return 0.38
          return 0.62
        }
        const makeMaterial = (tex, name) => {
          const mm = new THREE.MeshStandardMaterial({
            color: tex?.map ? 0xffffff : 0xc8a08c,
            roughness: roughnessFor(name),
            metalness: 0,
            side: THREE.FrontSide,
          })
          if (tex?.map) {
            loadTex(tex.map, THREE.SRGBColorSpace).then((t) => {
              if (!cancelled && t) {
                mm.map = t
                mm.needsUpdate = true
              }
            })
          }
          if (tex?.normalMap) {
            loadTex(tex.normalMap, THREE.NoColorSpace).then((t) => {
              if (!cancelled && t) {
                mm.normalMap = t
                mm.needsUpdate = true
              }
            })
          }
          return mm
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
        st.numVertices = geo.numVertices

        const mount = mountRef.current
        if (mount && st.renderer) {
          const w = mount.clientWidth
          const h = mount.clientHeight
          if (w > 0 && h > 0) {
            st.renderer.setSize(w, h, false)
            st.camera.aspect = w / h
            st.camera.updateProjectionMatrix()
          }
        }

        setStatus(`RigLogic eval (0/${rows.length})...`)
        setLoadProgress({ phase: 'rig', done: 0, total: rows.length })

        const allFrames = []
        for (let start = 0; start < rows.length; start += RIG_BATCH) {
          if (cancelled) return
          const slice = rows.slice(start, start + RIG_BATCH)
          const parsed = await fetchEvalRigBatch(blendshapes, slice)
          if (parsed.frameCount !== slice.length) {
            throw new Error(
              `rig batch @${start}: expected ${slice.length}, got ${parsed.frameCount}`,
            )
          }
          allFrames.push(...parsed.frames)
          setLoadProgress({ phase: 'rig', done: allFrames.length, total: rows.length })
          setStatus(`RigLogic eval (${allFrames.length}/${rows.length})...`)
        }
        if (cancelled) return

        rig.frames = allFrames
        lastAppliedRef.current = -1

        const fi = readPlaybackFrame()
        if (!applyFrame(fi)) {
          throw new Error('deform failed — rig frames empty or invalid')
        }
        lastAppliedRef.current = fi
        setLoadProgress(null)
        setStatus('ready')
      } catch (e) {
        if (!cancelled) setStatus(`오류: ${e.message}`)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [inferenceKey, serverBase])

  const showOverlay = status !== 'ready' && status !== 'idle'

  return (
    <div ref={mountRef} className="relative w-full h-full min-h-[200px] bg-[#1a1d24]">
      {showOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1d24]/90 p-6 text-center pointer-events-none">
          <div className="text-sm text-gray-300 space-y-2">
            <p>{status}</p>
            {loadProgress && (
              <p className="text-xs text-emerald-400">
                {loadProgress.phase === 'rig'
                  ? `RigLogic ${loadProgress.done}/${loadProgress.total}`
                  : '브라우저 deform 준비...'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
