'use client'

import { useEffect, useRef, useState, startTransition } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyVertexHighlight, syncRegionWireframeGeometry } from '../lib/riglogicVertexColors'
import { loadRegionUvTexture } from '../lib/loadRegionUvTexture'
import { loadUvMouthVertices } from '../lib/loadUvMouthVertices'
import { loadLipMask } from '../lib/loadLipMask'
import { loadMouthRegionMask, loadLowerFaceMask } from '../lib/loadVertexMask'
import { RIGLOGIC_LOD, resolveViewerHeadCount, highlightNeedsLitNormals } from '../lib/riglogicLod'
import {
  addRiglogicThreePointLighting,
  configureRiglogicRenderer,
} from '../lib/riglogicSceneLighting'
import {
  createLivePlaybackProfiler,
  recordCacheHit,
  recordCacheMiss,
  recordFetchBlock,
  recordPosUpdate,
  recordRaf,
  resetLiveProfiler,
  snapshotLiveProfiler,
  perfSnapSignature,
  updateBufferGap,
} from '../lib/livePlaybackProfiler'

const BLOCK = 30
/** 재생 위치 기준 미리 받아둘 블록 수 (30fps × 30프레임 × 3 ≈ 3초) */
const LOOKAHEAD_BLOCKS = 3

function blockStartForFrame(frameIndex) {
  return Math.floor(frameIndex / BLOCK) * BLOCK
}

function listBlocksToFetch(st, playhead, numFrames) {
  const fetched = st.fetchedBlockStarts
  const out = []
  const seen = new Set()
  const phBlock = blockStartForFrame(playhead)
  for (let b = 0; b <= LOOKAHEAD_BLOCKS; b += 1) {
    const bs = phBlock + b * BLOCK
    if (bs < numFrames && !fetched.has(bs) && !seen.has(bs)) {
      out.push(bs)
      seen.add(bs)
    }
  }
  for (let bs = 0; bs < numFrames; bs += BLOCK) {
    if (!fetched.has(bs) && !seen.has(bs)) {
      out.push(bs)
      seen.add(bs)
    }
  }
  return out
}

function highestCachedFrame(st) {
  let max = -1
  st.cache?.forEach((_, k) => {
    if (k > max) max = k
  })
  return max
}

function ingestFrameBlock(st, start, count, buf, stride) {
  const arr = new Float32Array(buf)
  for (let k = 0; k < count; k += 1) {
    st.cache.set(start + k, arr.subarray(k * stride, (k + 1) * stride))
  }
  st.streamedCount = Math.max(st.streamedCount || 0, start + count)
  st.fetchedBlockStarts.add(start)
  st.cachedMaxFrame = highestCachedFrame(st)
}

const VERTEX_MASK_MODES = new Set([
  'lip_mask', 'lip_mask_single', 'mouth_region_mask', 'lower_face_mask',
])

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

export default function RigLogicLiveViewer({ clip, serverBase = 'http://localhost:8765', dnaProfileId = '' }) {
  const mountRef = useRef(null)
  const stateRef = useRef({})
  const audioRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [meta, setMeta] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [frameInfo, setFrameInfo] = useState({ frame: 0, total: 0, streamed: 0, cachedMax: 0 })
  const [vertexHighlight, setVertexHighlight] = useState('off')
  const [maskDiag, setMaskDiag] = useState(null)
  const [showPerf, setShowPerf] = useState(true)
  const [perfSnap, setPerfSnap] = useState(null)
  const highlightRef = useRef('off')
  const perfRef = useRef(createLivePlaybackProfiler())
  const perfUiLastAt = useRef(0)
  const perfSnapSigRef = useRef('')
  const showPerfRef = useRef(true)

  const publishPerfSnap = (perf) => {
    const snap = snapshotLiveProfiler(perf)
    const sig = perfSnapSignature(snap)
    if (sig === perfSnapSigRef.current) return
    perfSnapSigRef.current = sig
    startTransition(() => {
      setPerfSnap(snap)
    })
  }

  const clearPerfSnap = () => {
    perfSnapSigRef.current = ''
    startTransition(() => setPerfSnap(null))
  }
  const needsNormalsRef = useRef(true)
  const frameUiLastAt = useRef(0)
  const prefetchTickLastAt = useRef(0)
  const paintHighlightFnRef = useRef(() => {})
  useEffect(() => { highlightRef.current = vertexHighlight }, [vertexHighlight])
  useEffect(() => { showPerfRef.current = showPerf }, [showPerf])
  useEffect(() => {
    needsNormalsRef.current = highlightNeedsLitNormals(vertexHighlight)
  }, [vertexHighlight])

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
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

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
      const rafT0 = performance.now()
      const st = stateRef.current
      const audio = audioRef.current
      const perf = perfRef.current
      if (st.geometry && st.cache && audio && st.numVertices) {
        const fps = st.fps || 30
        let fi = Math.floor(audio.currentTime * fps)
        if (fi < 0) fi = 0
        if (fi >= st.numFrames) fi = st.numFrames - 1
        st.playheadFrame = fi
        const frameData = st.cache.get(fi)
        if (frameData && fi !== st.curFrame) {
          recordCacheHit(perf)
          st.curFrame = fi
          const posT0 = performance.now()
          st.geometry.attributes.position.array.set(frameData)
          st.geometry.attributes.position.needsUpdate = true
          const posMs = performance.now() - posT0
          let normalMs = 0
          if (needsNormalsRef.current) {
            const nT0 = performance.now()
            st.geometry.computeVertexNormals()
            normalMs = performance.now() - nT0
          }
          recordPosUpdate(perf, posMs, normalMs)
          if (highlightRef.current === 'identity_uv') {
            syncRegionWireframeGeometry(st.mesh, st.geometry)
          }
          const now = performance.now()
          if (now - frameUiLastAt.current > 200) {
            frameUiLastAt.current = now
            startTransition(() => {
              setFrameInfo((p) => (p.frame === fi ? p : { ...p, frame: fi }))
            })
          }
        } else if (!frameData) {
          recordCacheMiss(perf, fi)
          const bs = blockStartForFrame(fi)
          const count = Math.min(BLOCK, st.numFrames - bs)
          if (!audio.paused && !st.buffering) {
            st.buffering = true
            st.resumeAfterBuffer = true
            audio.pause()
            const bufMsg = `버퍼링… (frame ${fi})`
            startTransition(() => {
              setPlaying((p) => (p ? false : p))
              setStatus((s) => (s === bufMsg ? s : bufMsg))
            })
          }
          const waitFetch = st.blockFetches.has(bs)
            ? st.blockFetches.get(bs)
            : (st.fetchBlock ? st.fetchBlock(bs, count) : null)
          waitFetch?.finally(() => {
            if (!st.resumeAfterBuffer) return
            const curFi = Math.min(
              st.numFrames - 1,
              Math.floor((audio.currentTime || 0) * (st.fps || 30)),
            )
            if (st.cache.get(curFi)) {
              st.buffering = false
              st.resumeAfterBuffer = false
              audio.play().catch(() => {})
              const readyMsg = highestCachedFrame(st) >= st.numFrames - 1 ? 'ready' : '스트리밍…'
              startTransition(() => {
                setPlaying((p) => (p ? p : true))
                setStatus((s) => (s === readyMsg ? s : readyMsg))
              })
            }
          })
        }
        // 재생 중: playhead 앞 블록 선행 요청
        const nowPrefetch = performance.now()
        if (nowPrefetch - prefetchTickLastAt.current > 80 && st.fetchBlock && st.numFrames) {
          prefetchTickLastAt.current = nowPrefetch
          const ahead = listBlocksToFetch(st, fi, st.numFrames)
          if (ahead.length > 0) {
            const bs = ahead[0]
            const count = Math.min(BLOCK, st.numFrames - bs)
            if (!st.fetchedBlockStarts.has(bs) && !st.blockFetches.has(bs)) {
              st.fetchBlock(bs, count)
            }
          }
        }
        updateBufferGap(perf, fi, st.cache, st.curFrame)
      }
      controls.update()
      renderer.render(scene, camera)
      recordRaf(perf, performance.now() - rafT0)
      if (showPerfRef.current) {
        const now = performance.now()
        if (now - perfUiLastAt.current > 500) {
          perfUiLastAt.current = now
          publishPerfSnap(perf)
        }
      }
    }
    animate()
    Object.assign(stateRef.current, { scene, camera, renderer, controls, lights })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // load clip (live)
  useEffect(() => {
    if (!clip) return
    let cancelled = false
    const st = stateRef.current
    const u = (p) => `${serverBase}${p}`
    const cq = encodeURIComponent(clip)

    async function load() {
      try {
        perfRef.current = createLivePlaybackProfiler()
        clearPerfSnap()
        setStatus('연결 중...')
        const m = await fetch(u(`/meta?clip=${cq}`)).then((r) => r.json())
        if (cancelled) return
        if (m.error) throw new Error(m.error)
        setMeta(m)

        setStatus('지오메트리 로딩...')
        const [idxBuf, uvBuf] = await Promise.all([
          fetch(u(m.indicesUrl)).then((r) => r.arrayBuffer()),
          fetch(u(m.uvsUrl)).then((r) => r.arrayBuffer()),
        ])
        if (cancelled) return
        const indices = new Uint32Array(idxBuf)
        const uvs = new Float32Array(uvBuf)

        if (st.mesh) {
          st.scene.remove(st.mesh)
          st.geometry.dispose()
          const mats = Array.isArray(st.material) ? st.material : [st.material]
          mats.forEach((mm) => {
            if (mm.map) mm.map.dispose()
            if (mm.normalMap) mm.normalMap.dispose()
            mm.dispose()
          })
        }

        const geometry = new THREE.BufferGeometry()
        const pos = new Float32Array(m.numVertices * 3)
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
        geometry.setIndex(new THREE.BufferAttribute(indices, 1))

        const loader = new THREE.TextureLoader()
        loader.setCrossOrigin('anonymous')
        const regionUvTexture = await loadRegionUvTexture(loader, THREE, serverBase)
        const uvMouth = await loadUvMouthVertices(serverBase)
        const lipMask = await loadLipMask(serverBase)
        const mouthRegionMask = await loadMouthRegionMask(serverBase)
        const lowerFaceMask = await loadLowerFaceMask(serverBase)
        const loadTex = (name, colorSpace) =>
          new Promise((resolve) => {
            loader.load(
              u(`/texture?name=${name}`),
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
        const roughnessFor = (name) => {
          const n = (name || '').toLowerCase()
          if (n.startsWith('eyeleft') || n.startsWith('eyeright')) return 0.18
          if (n.startsWith('teeth')) return 0.38
          return 0.62
        }
        const makeMaterial = (tex, name) => {
          const hasMap = !!(tex && tex.map)
          const mm = new THREE.MeshStandardMaterial({
            color: hasMap ? 0xffffff : 0xc8a08c,
            roughness: roughnessFor(name),
            metalness: 0,
          })
          if (tex && tex.map)
            loadTex(tex.map, THREE.SRGBColorSpace).then((t) => {
              if (!cancelled && t && !mm.userData._vertexHighlight) { mm.map = t; mm.needsUpdate = true }
            })
          if (tex && tex.normalMap)
            loadTex(tex.normalMap, THREE.NoColorSpace).then((t) => {
              if (!cancelled && t) { mm.normalMap = t; mm.needsUpdate = true }
            })
          return mm
        }

        let material
        if (m.groups && m.groups.length > 0) {
          geometry.clearGroups()
          material = m.groups.map((g, i) => {
            geometry.addGroup(g.indexStart, g.indexCount, i)
            return makeMaterial(g.textures, g.name)
          })
        } else {
          material = makeMaterial({}, m.meshes && m.meshes[0])
        }
        const mesh = new THREE.Mesh(geometry, material)
        mesh.frustumCulled = false
        mesh.userData._baseMaterials = material
        st.scene.add(mesh)

        // camera framing
        const cy = (m.bboxMax[1] + m.bboxMin[1]) / 2
        const size = Math.max(
          m.bboxMax[0] - m.bboxMin[0],
          m.bboxMax[1] - m.bboxMin[1],
          m.bboxMax[2] - m.bboxMin[2],
        )
        st.lights?.focusTarget(cy)
        st.camera.position.set(0, cy, size * 2.2)
        st.controls.target.set(0, cy, 0)
        st.controls.update()

        st.mesh = mesh
        st.geometry = geometry
        st.material = material
        st.regionUvTexture = regionUvTexture
        st.uvMouth = uvMouth
        st.lipMask = lipMask
        st.mouthRegionMask = mouthRegionMask
        st.lowerFaceMask = lowerFaceMask
        st.headVertexCount = m.headVertexCount ?? m.meshVertexStarts?.[1]
        st.meshVertexStarts = m.meshVertexStarts
          || [0, st.headVertexCount, m.numVertices]
        st.cache = new Map()
        st.streamedCount = 0
        st.fetchedBlockStarts = new Set()
        st.blockFetches = new Map()
        st.buffering = false
        st.resumeAfterBuffer = false
        st.playheadFrame = 0
        st.numVertices = m.numVertices
        st.numFrames = m.numFrames
        st.fps = m.fps
        st.metaLod = RIGLOGIC_LOD
        if (m.lod != null && m.lod !== RIGLOGIC_LOD) {
          console.warn(`[RigLogic] serve LOD ${m.lod} != ${RIGLOGIC_LOD} — restart serve.py with RIGLOGIC_LOD=0`)
        }
        st.curFrame = -1
        paintLiveHighlight(highlightRef.current)

        if (audioRef.current) {
          audioRef.current.src = u(m.audioUrl)
          audioRef.current.load()
        }
        setFrameInfo({ frame: 0, total: m.numFrames, streamed: 0 })
        setStatus('스트리밍...')

        const stride = m.numVertices * 3
        const perf = perfRef.current
        perf.prefetchInFlight = true

        st.fetchBlock = async (start, count) => {
          if (st.fetchedBlockStarts.has(start)) return
          if (st.blockFetches.has(start)) {
            await st.blockFetches.get(start)
            return
          }
          const run = (async () => {
            const fetchT0 = performance.now()
            const resp = await fetch(u(`/frames?clip=${cq}&start=${start}&count=${count}`))
            const totalMs = performance.now() - fetchT0
            const buf = await resp.arrayBuffer()
            if (cancelled) return
            const serverEvalMs = Number.parseFloat(resp.headers.get('X-Eval-Total-Ms') || '')
            recordFetchBlock(perf, {
              totalMs,
              serverEvalMs: Number.isFinite(serverEvalMs) ? serverEvalMs : NaN,
              start,
              count,
              cachedFrames: resp.headers.get('X-Cache-Hits'),
            })
            ingestFrameBlock(st, start, count, buf, stride)
            setFrameInfo((p) => ({
              ...p,
              streamed: st.streamedCount,
              cachedMax: (st.cachedMaxFrame ?? -1) + 1,
            }))
            if (showPerfRef.current) publishPerfSnap(perf)
          })()
          st.blockFetches.set(start, run)
          try {
            await run
          } finally {
            st.blockFetches.delete(start)
          }
        }

        // first block — then background prefetch
        await st.fetchBlock(0, Math.min(BLOCK, m.numFrames))
        if (cancelled) return
        pos.set(st.cache.get(0))
        geometry.attributes.position.needsUpdate = true
        if (needsNormalsRef.current) geometry.computeVertexNormals()
        if (VERTEX_MASK_MODES.has(highlightRef.current)) {
          paintHighlightFnRef.current(highlightRef.current)
        }
        setStatus('스트리밍…')

        const nBlocks = Math.ceil(m.numFrames / BLOCK)
        st.prefetchActive = true
        ;(async function prefetchLoop() {
          while (!cancelled && st.prefetchActive) {
            const ph = st.playheadFrame ?? 0
            const todo = listBlocksToFetch(st, ph, m.numFrames)
            if (todo.length === 0) {
              if (st.fetchedBlockStarts.size >= nBlocks) {
                perf.prefetchInFlight = false
                if (!st.buffering) setStatus('ready')
                break
              }
              await new Promise((r) => setTimeout(r, 50))
              continue
            }
            const bs = todo[0]
            await st.fetchBlock(bs, Math.min(BLOCK, m.numFrames - bs))
          }
        })()
      } catch (e) {
        if (!cancelled) setStatus('오류: ' + e.message + ' (서버 실행 확인: serve.py)')
      }
    }
    load()
    return () => {
      cancelled = true
      st.prefetchActive = false
    }
  }, [clip, serverBase, dnaProfileId])

  const paintLiveHighlight = (mode) => {
    const st = stateRef.current
    if (!st.geometry || !st.mesh) return
    const headVertexCount = resolveViewerHeadCount(st)
    const payload = {
      headVertexCount,
      meshVertexStarts: st.meshVertexStarts,
      numVertices: st.numVertices,
      serveLod: RIGLOGIC_LOD,
    }
    if (mode === 'identity_uv' || mode === 'uv_mouth') {
      payload.regionUvTexture = st.regionUvTexture
    }
    if (mode === 'uv_mouth' && st.uvMouth) {
      payload.lip = st.uvMouth.lip
      payload.mouth = st.uvMouth.mouth
    }
    if (mode === 'lip_mask' || mode === 'lip_mask_single') {
      payload.lipMask = st.lipMask
      payload.lipMaskSingleColor = mode === 'lip_mask_single'
    }
    if (mode === 'mouth_region_mask') {
      payload.mouthRegionMask = st.mouthRegionMask
    }
    if (mode === 'lower_face_mask') {
      payload.lowerFaceMask = st.lowerFaceMask
    }
    const baseMaterials = st.mesh?.userData._baseMaterials || st.material
    const highlightMode = mode === 'lip_mask_single' ? 'lip_mask' : mode
    const result = applyVertexHighlight(st.mesh, st.geometry, baseMaterials, highlightMode, payload)
    if (result?.material) {
      st.material = result.material
      st.mesh.material = result.material
    }
    if (st.scene) {
      st.scene.background = new THREE.Color(
        highlightMode === 'identity_uv' || highlightMode === 'uv_mouth' ? 0xd4c4e8 : 0x1a1d24,
      )
    }
    if (highlightMode === 'lip_mask' || highlightMode === 'mouth_region_mask' || highlightMode === 'lower_face_mask') {
      const d = result?.diag || null
      setMaskDiag((prev) => {
        if (d && prev
          && prev.ok === d.ok
          && prev.error === d.error
          && prev.paintedVerts === d.paintedVerts
          && prev.vertexCount === d.vertexCount) return prev
        return d
      })
    } else {
      setMaskDiag(null)
    }
  }
  paintHighlightFnRef.current = paintLiveHighlight

  useEffect(() => {
    let cancelled = false
    async function syncHighlight() {
      if (VERTEX_MASK_MODES.has(vertexHighlight)) {
        await ensureVertexMaskLoaded(vertexHighlight, stateRef.current, serverBase)
        if (cancelled) return
      }
      paintLiveHighlight(vertexHighlight)
    }
    syncHighlight()
    return () => { cancelled = true }
  }, [vertexHighlight, serverBase])

  const togglePlay = () => {
    const a = audioRef.current
    const st = stateRef.current
    if (!a || !st.numFrames) return
    if (a.paused) {
      resetLiveProfiler(perfRef.current)
      clearPerfSnap()
      const fi = Math.min(
        st.numFrames - 1,
        Math.floor(a.currentTime * (st.fps || 30)),
      )
      if (!st.cache?.get(fi)) {
        const bs = blockStartForFrame(fi)
        if (st.fetchBlock && !st.fetchedBlockStarts?.has(bs)) {
          st.fetchBlock(bs, Math.min(BLOCK, st.numFrames - bs))
        }
        setStatus(`버퍼링… (frame ${fi})`)
        st.resumeAfterBuffer = true
        return
      }
      a.play()
      setPlaying(true)
      setStatus(highestCachedFrame(st) >= st.numFrames - 1 ? 'ready' : '스트리밍…')
    } else {
      a.pause()
      setPlaying(false)
    }
  }
  const restart = () => {
    if (audioRef.current) audioRef.current.currentTime = 0
  }
  const seek = (e) => {
    const a = audioRef.current
    const st = stateRef.current
    if (!a || !st.fps) return
    const fi = Number(e.target.value)
    a.currentTime = fi / st.fps
    if (!st.cache?.get(fi) && st.fetchBlock) {
      const bs = blockStartForFrame(fi)
      const count = Math.min(BLOCK, st.numFrames - bs)
      st.fetchBlock(bs, count)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/60 border-b border-white/10 text-sm text-gray-200">
        <button
          type="button"
          onClick={togglePlay}
          className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
        >
          {playing ? '일시정지' : '재생'}
        </button>
        <button type="button" onClick={restart} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">
          처음으로
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frameInfo.total - 1)}
          value={frameInfo.frame}
          onChange={seek}
          className="w-48"
        />
        <span className="text-gray-400">
          frame {frameInfo.frame} / {frameInfo.total}
        </span>
        <span className="text-emerald-300/80 text-xs">
          live · 캐시 {frameInfo.cachedMax || frameInfo.streamed}/{frameInfo.total}
          {frameInfo.total > 0 && (frameInfo.cachedMax || 0) < frameInfo.total && (
            <span className="text-amber-400/90"> · 전체 로드 전 재생 시 버퍼링</span>
          )}
        </span>
        {meta && (
          <span className="text-gray-500 text-xs">
            {meta.numVertices} verts · {meta.fps?.toFixed(1)} fps · LOD{RIGLOGIC_LOD}
          </span>
        )}
        <span className="ml-auto text-gray-400">{status}</span>
        <button
          type="button"
          onClick={() => setShowPerf((v) => !v)}
          className={`px-2 py-1 text-xs rounded border ${
            showPerf
              ? 'border-amber-500/50 bg-amber-900/30 text-amber-200'
              : 'border-white/10 bg-white/5 text-gray-400'
          }`}
          title="라이브 재생 병목 구간 측정"
        >
          성능
        </button>
        <select
          value={vertexHighlight}
          onChange={(e) => setVertexHighlight(e.target.value)}
          className="text-xs bg-gray-900 border border-white/10 rounded px-2 py-1 text-gray-300"
          title="head mesh vertex debug colors"
        >
          <option value="off">텍스처 (skin)</option>
          <option value="uv_mouth">UV 입·입술 (CSV)</option>
          <option value="identity_uv">Identity UV (T_Gray_Head_D)</option>
          <option value="lip_mask">LVE Lip Mask (LOD0, subgroup)</option>
          <option value="lip_mask_single">LVE Lip Mask (LOD0, 단일색)</option>
          <option value="mouth_region_mask">Mouth Region Mask (LOD0)</option>
          <option value="lower_face_mask">Lower Face Mask (LOD0)</option>
        </select>
      </div>
      <div ref={mountRef} className="relative flex-1 min-h-[80px] min-w-0">
        {showPerf && perfSnap && (
          <div className="pointer-events-none absolute right-2 top-2 z-20 max-w-[320px] rounded border border-amber-500/30 bg-black/75 px-3 py-2 text-[10px] leading-relaxed text-gray-200 font-mono">
            <div className="text-amber-300 font-semibold mb-1">
              병목: {perfSnap.dominantLabel}
            </div>
            <div>캐시 hit/miss: {perfSnap.cacheHit}/{perfSnap.cacheMiss} ({perfSnap.missRate}% miss)</div>
            <div>position set avg: {perfSnap.avgPosMs} ms</div>
            <div>normals avg/max: {perfSnap.avgNormalMs} / {perfSnap.maxNormalMs} ms</div>
            <div>fetch avg: {perfSnap.avgFetchMs} ms · server eval avg: {perfSnap.avgServerEvalMs} ms</div>
            <div>rAF avg/max: {perfSnap.avgRafMs} / {perfSnap.maxRafMs} ms</div>
            <div>버퍼 gap (audio−streamed): {perfSnap.bufferGap} frames</div>
            {perfSnap.lastMissFrame != null && (
              <div className="text-red-300">last miss frame: {perfSnap.lastMissFrame}</div>
            )}
            {perfSnap.lastFetchBlocks.length > 0 && (
              <div className="mt-1 text-gray-400">
                fetch blocks:
                {perfSnap.lastFetchBlocks.map((b) => (
                  <div key={`${b.start}-${b.count}`}>
                    {b.start}..{b.start + b.count - 1}: {b.totalMs.toFixed(0)}ms
                    {Number.isFinite(b.serverEvalMs) ? ` (eval ${b.serverEvalMs.toFixed(0)}ms)` : ''}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                resetLiveProfiler(perfRef.current)
                publishPerfSnap(perfRef.current)
              }}
              className="pointer-events-auto mt-1 text-amber-400 hover:text-amber-200"
            >
              통계 초기화
            </button>
          </div>
        )}
        {(vertexHighlight === 'lip_mask'
          || vertexHighlight === 'mouth_region_mask'
          || vertexHighlight === 'lower_face_mask') && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1 bg-gray-900/85 border-b border-white/10 text-[11px] text-gray-300">
            {vertexHighlight === 'lip_mask' && (
              <>
                <span className="text-gray-500">MH-LVE-LIP-v1:</span>
                <span><span style={{ color: '#e64019' }}>■</span> upper_outer</span>
                <span><span style={{ color: '#2673f2' }}>■</span> lower_outer</span>
                <span><span style={{ color: '#f2c719' }}>■</span> upper_inner</span>
                <span><span style={{ color: '#26cc66' }}>■</span> lower_inner</span>
                <span><span style={{ color: '#cc26cc' }}>■</span> corner L</span>
                <span><span style={{ color: '#0dc7c7' }}>■</span> corner R</span>
              </>
            )}
            {vertexHighlight === 'mouth_region_mask' && (
              <>
                <span className="text-gray-500">MH-LVE-MOUTHREGION-v1</span>
                <span><span style={{ color: '#eb8530' }}>■</span> mouth region</span>
              </>
            )}
            {vertexHighlight === 'lower_face_mask' && (
              <>
                <span className="text-gray-500">MH-LVE-LOWERFACE-v1</span>
                <span><span style={{ color: '#7a61e0' }}>■</span> lower face</span>
              </>
            )}
            {maskDiag?.error && (
              <span className="text-red-400 ml-2">{maskDiag.error}</span>
            )}
            {maskDiag?.ok && (
              <span className="text-emerald-400 ml-auto">
                {maskDiag.paintedVerts ?? maskDiag.vertexCount ?? maskDiag.allLipCount} verts
              </span>
            )}
          </div>
        )}
      </div>
      <audio ref={audioRef} className="hidden" onEnded={() => setPlaying(false)} />
    </div>
  )
}
