'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  addRiglogicThreePointLighting,
  configureRiglogicRenderer,
} from '../lib/riglogicSceneLighting'

const api = (clip, file, dnaProfile) => {
  const q = new URLSearchParams({
    clip,
    file,
    dna: dnaProfile,
  })
  return `/api/riglogic?${q.toString()}`
}

// IEEE half-float -> float32
function decodeHalf(u16, out) {
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i]
    const s = (h & 0x8000) >> 15
    const e = (h & 0x7c00) >> 10
    const f = h & 0x03ff
    let val
    if (e === 0) {
      val = (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024)
    } else if (e === 0x1f) {
      val = f ? NaN : (s ? -Infinity : Infinity)
    } else {
      val = (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024)
    }
    out[i] = val
  }
  return out
}

export default function RigLogicViewer({ clip, dnaProfileId }) {
  const mountRef = useRef(null)
  const stateRef = useRef({})
  const audioRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [manifest, setManifest] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [frameInfo, setFrameInfo] = useState({ frame: 0, total: 0 })

  // --- three.js scene setup (once) ---
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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)

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
      const st = stateRef.current
      const audio = audioRef.current
      if (st.geometry && st.frames && audio && st.numVertices) {
        const fps = st.fps || 30
        let fi = Math.floor(audio.currentTime * fps)
        if (fi < 0) fi = 0
        if (fi >= st.numFrames) fi = st.numFrames - 1
        if (fi !== st.curFrame) {
          st.curFrame = fi
          const stride = st.numVertices * 3
          const pos = st.geometry.attributes.position.array
          const base = fi * stride
          if (st.half) {
            // decode this frame's slice
            const slice = st.frames.subarray(base, base + stride)
            decodeHalf(slice, pos)
          } else {
            pos.set(st.frames.subarray(base, base + stride))
          }
          st.geometry.attributes.position.needsUpdate = true
          st.geometry.computeVertexNormals()
          st.geometry.computeBoundingSphere()
          setFrameInfo({ frame: fi, total: st.numFrames })
        }
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    stateRef.current.scene = scene
    stateRef.current.camera = camera
    stateRef.current.renderer = renderer
    stateRef.current.controls = controls
    stateRef.current.lights = lights

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // --- load clip data ---
  useEffect(() => {
    if (!clip || !dnaProfileId) return
    let cancelled = false
    const st = stateRef.current

    async function load() {
      try {
        setStatus('manifest 로딩...')
        const man = await fetch(api(clip, 'manifest.json', dnaProfileId)).then((r) => r.json())
        if (cancelled) return
        setManifest(man)

        setStatus('인덱스 로딩...')
        const idxBuf = await fetch(api(clip, man.indicesFile, dnaProfileId)).then((r) => r.arrayBuffer())
        const indices = new Uint32Array(idxBuf)

        let uvs = null
        if (man.uvsFile) {
          const uvBuf = await fetch(api(clip, man.uvsFile, dnaProfileId)).then((r) => r.arrayBuffer())
          uvs = new Float32Array(uvBuf)
        }

        setStatus(`프레임 데이터 로딩 (${man.numFrames} frames)...`)
        const framesBuf = await fetch(api(clip, man.framesFile, dnaProfileId)).then((r) => r.arrayBuffer())
        if (cancelled) return
        const half = man.positionDtype === 'float16'
        const frames = half ? new Uint16Array(framesBuf) : new Float32Array(framesBuf)

        // build / replace geometry
        if (st.mesh) {
          st.scene.remove(st.mesh)
          st.geometry.dispose()
          const mats = Array.isArray(st.material) ? st.material : [st.material]
          mats.forEach((m) => {
            if (m.map) m.map.dispose()
            if (m.normalMap) m.normalMap.dispose()
            m.dispose()
          })
        }
        const geometry = new THREE.BufferGeometry()
        const pos = new Float32Array(man.numVertices * 3)
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
        geometry.setIndex(new THREE.BufferAttribute(indices, 1))

        // initialize with frame 0
        const stride = man.numVertices * 3
        if (half) decodeHalf(frames.subarray(0, stride), pos)
        else pos.set(frames.subarray(0, stride))
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()

        // load textures (default flipY=true matches MetaHuman DNA UV V origin)
        const loader = new THREE.TextureLoader()
        const loadTex = (file, colorSpace) =>
          new Promise((resolve) => {
            loader.load(
              api(clip, file, dnaProfileId),
              (t) => {
                t.flipY = true
                t.colorSpace = colorSpace
                t.anisotropy = 8
                resolve(t)
              },
              undefined,
              () => resolve(null),
            )
          })

        // per-mesh roughness for a more natural look
        const roughnessFor = (name) => {
          const n = (name || '').toLowerCase()
          if (n.startsWith('eyeleft') || n.startsWith('eyeright')) return 0.18
          if (n.startsWith('teeth')) return 0.38
          return 0.62
        }

        const makeMaterial = (tex, name) => {
          const hasMap = !!(tex && tex.map)
          const m = new THREE.MeshStandardMaterial({
            color: hasMap ? 0xffffff : 0xc8a08c,
            roughness: roughnessFor(name),
            metalness: 0.0,
            flatShading: false,
          })
          if (tex && tex.map) {
            loadTex(tex.map, THREE.SRGBColorSpace).then((t) => {
              if (cancelled || !t) return
              m.map = t
              m.needsUpdate = true
            })
          }
          if (tex && tex.normalMap) {
            loadTex(tex.normalMap, THREE.NoColorSpace).then((t) => {
              if (cancelled || !t) return
              m.normalMap = t
              m.needsUpdate = true
            })
          }
          return m
        }

        // multi-material via geometry groups (head / teeth / eyes), else single
        let material
        const groups = man.groups
        if (groups && groups.length > 0) {
          geometry.clearGroups()
          const mats = groups.map((g, i) => {
            geometry.addGroup(g.indexStart, g.indexCount, i)
            return makeMaterial(g.textures, g.name)
          })
          material = mats
        } else {
          material = makeMaterial(man.textures || {}, man.meshes && man.meshes[0])
        }
        const mesh = new THREE.Mesh(geometry, material)
        st.scene.add(mesh)

        // frame camera on bbox
        const bmin = man.bboxMin
        const bmax = man.bboxMax
        const size = Math.max(
          bmax[0] - bmin[0],
          bmax[1] - bmin[1],
          bmax[2] - bmin[2],
        )
        const dist = size * 2.2
        const cy = (bmax[1] + bmin[1]) / 2
        st.lights?.focusTarget(cy)
        st.camera.position.set(0, cy, dist)
        st.controls.target.set(0, cy, 0)
        st.controls.update()

        st.mesh = mesh
        st.geometry = geometry
        st.material = material
        st.frames = frames
        st.half = half
        st.numVertices = man.numVertices
        st.numFrames = man.numFrames
        st.fps = man.fps
        st.curFrame = -1

        // audio
        if (audioRef.current && man.audioFile) {
          audioRef.current.src = api(clip, man.audioFile, dnaProfileId)
          audioRef.current.load()
        }
        setStatus('ready')
        setFrameInfo({ frame: 0, total: man.numFrames })
      } catch (e) {
        if (!cancelled) setStatus('오류: ' + e.message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [clip, dnaProfileId])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play()
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  const restart = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/60 border-b border-white/10 text-sm text-gray-200">
        <button
          type="button"
          onClick={togglePlay}
          className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-40"
          disabled={status !== 'ready'}
        >
          {playing ? '일시정지' : '재생'}
        </button>
        <button
          type="button"
          onClick={restart}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20"
          disabled={status !== 'ready'}
        >
          처음으로
        </button>
        <span className="text-gray-400">
          frame {frameInfo.frame} / {frameInfo.total}
        </span>
        {manifest && (
          <span className="text-gray-500">
            {manifest.meshes?.join(', ')} · {manifest.numVertices} verts · {manifest.fps?.toFixed(1)} fps · LOD{manifest.lod}
          </span>
        )}
        <span className="ml-auto text-gray-400">{status}</span>
      </div>
      <div ref={mountRef} className="flex-1 min-h-0" />
      <audio ref={audioRef} className="hidden" onEnded={() => setPlaying(false)} />
    </div>
  )
}
