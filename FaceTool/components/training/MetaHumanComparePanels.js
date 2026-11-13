'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { deformFrame } from '@/lib/riglogicDeform'
import { loadRigCompareBundle } from '@/lib/eval/rigLogicEvalLoad'
import { slicePositions } from '@/lib/eval/rigHeadGeometry'
import {
  computeSignedDistances,
  signedDistanceToRgb,
  computeHistogram,
  scanGlobalSignedRange,
} from '@/lib/eval/signedDistance'

const DEFAULT_MATCH = {
  avgSignedDist: '0',
  avgAbsDist: '0',
  maxPositive: '0',
  maxNegative: '0',
  dataMin: '0',
  dataMax: '0',
  currentAvgSigned: '0',
  frameCount: 0,
}

function readFrame(currentFrame, playbackFrameRef) {
  if (playbackFrameRef?.current != null) return playbackFrameRef.current
  return currentFrame
}

function RigLogicSharedEngine({
  bundle,
  dualMountRef,
  wireMountRef,
  heatMountRef,
  currentFrame = 0,
  playbackFrameRef = null,
  gtXOffset = -4,
  predXOffset = 4,
  wireframeOpacity = 0.65,
  showGt = true,
  showPred = true,
  scaleMin = -0.01,
  scaleMax = 0.01,
  isPlaying = false,
  onMatchUpdate,
  onHistogramUpdate,
}) {
  const engineRef = useRef({})
  const statsRef = useRef({
    frameCount: 0,
    sumSignedDist: 0,
    sumAbsDist: 0,
    maxPositive: 0,
    maxNegative: 0,
  })
  const isPlayingRef = useRef(isPlaying)
  const scaleRef = useRef({ min: scaleMin, max: scaleMax })
  const currentFrameRef = useRef(currentFrame)
  const onMatchUpdateRef = useRef(onMatchUpdate)
  const onHistogramUpdateRef = useRef(onHistogramUpdate)
  const uiRef = useRef({
    gtXOffset,
    predXOffset,
    wireframeOpacity,
    showGt,
    showPred,
  })

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    onMatchUpdateRef.current = onMatchUpdate
  }, [onMatchUpdate])

  useEffect(() => {
    onHistogramUpdateRef.current = onHistogramUpdate
  }, [onHistogramUpdate])

  useEffect(() => {
    scaleRef.current = { min: scaleMin, max: scaleMax }
    engineRef.current.applyFrame?.(readFrame(currentFrameRef.current, playbackFrameRef), true)
  }, [scaleMin, scaleMax, playbackFrameRef])

  useEffect(() => {
    uiRef.current = { gtXOffset, predXOffset, wireframeOpacity, showGt, showPred }
    const v = engineRef.current.views
    if (!v) return
    if (v.dual?.meshes.gt) {
      v.dual.meshes.gt.position.x = gtXOffset
      v.dual.meshes.pred.position.x = predXOffset
    }
    if (v.wire?.meshes.gt) {
      v.wire.meshes.gt.material.opacity = wireframeOpacity
      v.wire.meshes.pred.material.opacity = wireframeOpacity
      v.wire.meshes.gt.visible = showGt
      v.wire.meshes.pred.visible = showPred
    }
  }, [gtXOffset, predXOffset, wireframeOpacity, showGt, showPred])

  useEffect(() => {
    if (!isPlaying) {
      statsRef.current = {
        frameCount: 0,
        sumSignedDist: 0,
        sumAbsDist: 0,
        maxPositive: 0,
        maxNegative: 0,
      }
    }
  }, [isPlaying])

  useEffect(() => {
    const dualMount = dualMountRef.current
    const wireMount = wireMountRef.current
    const heatMount = heatMountRef.current
    if (!bundle || !dualMount || !wireMount || !heatMount) return undefined

    const { assets, baseGeometry, material, camera: cam, target } = bundle
    const evalV = bundle.evalVertexCount || bundle.headVertexCount || assets.V
    const gtFull = new Float32Array(assets.V * 3)
    const predFull = new Float32Array(assets.V * 3)

    const cloneMaterials = (mat) => {
      if (Array.isArray(mat)) return mat.map((m) => m.clone())
      return mat.clone()
    }

    const makeView = (mount, { bright = false } = {}) => {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1a1d24)
      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000)
      camera.position.set(cam.position[0], cam.position[1], cam.position[2])
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(1)
      mount.appendChild(renderer.domElement)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.target.set(target[0], target[1], target[2])
      if (bright) {
        scene.add(new THREE.AmbientLight(0xffffff, 0.85))
        const key = new THREE.DirectionalLight(0xfff5ee, 1.35)
        key.position.set(40, 60, 80)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.55)
        fill.position.set(-30, 20, 50)
        scene.add(fill)
        const rim = new THREE.DirectionalLight(0xffffff, 0.35)
        rim.position.set(0, 40, -60)
        scene.add(rim)
      } else {
        scene.add(new THREE.AmbientLight(0xffffff, 0.55))
        const key = new THREE.DirectionalLight(0xffffff, 1.0)
        key.position.set(40, 60, 80)
        scene.add(key)
      }
      return { scene, camera, renderer, controls, mount, meshes: {} }
    }

    const mkGeo = () => {
      const g = baseGeometry.clone()
      g.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(evalV * 3), 3),
      )
      return g
    }

    const views = {
      dual: makeView(dualMount, { bright: true }),
      wire: makeView(wireMount),
      heat: makeView(heatMount),
    }

    const gtGeo = mkGeo()
    const predGeo = mkGeo()
    views.dual.meshes.gt = new THREE.Mesh(gtGeo, cloneMaterials(material))
    views.dual.meshes.pred = new THREE.Mesh(predGeo, cloneMaterials(material))
    views.dual.meshes.gt.position.x = uiRef.current.gtXOffset
    views.dual.meshes.pred.position.x = uiRef.current.predXOffset
    views.dual.scene.add(views.dual.meshes.gt, views.dual.meshes.pred)

    views.wire.meshes.gt = new THREE.Mesh(
      mkGeo(),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        wireframe: true,
        transparent: true,
        opacity: uiRef.current.wireframeOpacity,
      }),
    )
    views.wire.meshes.pred = new THREE.Mesh(
      mkGeo(),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        wireframe: true,
        transparent: true,
        opacity: uiRef.current.wireframeOpacity,
      }),
    )
    views.wire.scene.add(views.wire.meshes.gt, views.wire.meshes.pred)

    const hmGeo = mkGeo()
    hmGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(evalV * 3), 3))
    views.heat.meshes.heatmap = new THREE.Mesh(
      hmGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
    )
    views.heat.scene.add(views.heat.meshes.heatmap)

    const resizeAll = () => {
      for (const v of Object.values(views)) {
        const w = v.mount.clientWidth
        const h = v.mount.clientHeight
        if (w <= 0 || h <= 0) return
        v.renderer.setSize(w, h, false)
        v.camera.aspect = w / h
        v.camera.updateProjectionMatrix()
      }
    }
    const ro = new ResizeObserver(resizeAll)
    ro.observe(dualMount)
    ro.observe(wireMount)
    ro.observe(heatMount)
    resizeAll()

    let lastFi = -1
    let lastStatsKey = ''

    const applyFrame = (fi, forceStats = false) => {
      const { gtFrames, predFrames } = bundle
      const idx = Math.max(0, Math.min(fi, gtFrames.length - 1, predFrames.length - 1))
      const gf = gtFrames[idx]
      const pf = predFrames[idx]
      if (!gf || !pf) return

      deformFrame(assets, gf.bs, gf.jo, gtFull)
      deformFrame(assets, pf.bs, pf.jo, predFull)
      const gtEval = slicePositions(gtFull, evalV)
      const predEval = slicePositions(predFull, evalV)
      const ui = uiRef.current

      views.dual.meshes.gt.geometry.getAttribute('position').array.set(gtEval)
      views.dual.meshes.gt.geometry.getAttribute('position').needsUpdate = true
      views.dual.meshes.gt.geometry.computeVertexNormals()
      views.dual.meshes.pred.geometry.getAttribute('position').array.set(predEval)
      views.dual.meshes.pred.geometry.getAttribute('position').needsUpdate = true
      views.dual.meshes.pred.geometry.computeVertexNormals()

      views.wire.meshes.gt.visible = ui.showGt
      views.wire.meshes.pred.visible = ui.showPred
      if (ui.showGt) {
        views.wire.meshes.gt.geometry.getAttribute('position').array.set(gtEval)
        views.wire.meshes.gt.geometry.getAttribute('position').needsUpdate = true
      }
      if (ui.showPred) {
        views.wire.meshes.pred.geometry.getAttribute('position').array.set(predEval)
        views.wire.meshes.pred.geometry.getAttribute('position').needsUpdate = true
      }

      const { min: sMin, max: sMax } = scaleRef.current
      const dists = computeSignedDistances(gtEval, predEval, evalV)
      const mesh = views.heat.meshes.heatmap
      mesh.geometry.getAttribute('position').array.set(gtEval)
      mesh.geometry.getAttribute('position').needsUpdate = true
      const colAttr = mesh.geometry.getAttribute('color')

      let dataMin = Infinity
      let dataMax = -Infinity
      let sum = 0
      let maxPos = 0
      let maxNeg = 0
      for (let i = 0; i < evalV; i++) {
        const d = dists[i]
        if (d < dataMin) dataMin = d
        if (d > dataMax) dataMax = d
        sum += d
        if (d > maxPos) maxPos = d
        if (d < maxNeg) maxNeg = d
        const { r, g, b } = signedDistanceToRgb(d, sMin, sMax)
        colAttr.array[i * 3] = r
        colAttr.array[i * 3 + 1] = g
        colAttr.array[i * 3 + 2] = b
      }
      colAttr.needsUpdate = true

      const statsKey = `${fi}|${sMin}|${sMax}|${isPlayingRef.current}`
      const shouldEmitStats = forceStats || statsKey !== lastStatsKey
      if (shouldEmitStats) {
        lastStatsKey = statsKey
        const avg = sum / evalV
        const avgAbs = dists.reduce((a, v) => a + Math.abs(v), 0) / evalV
        let avgSignedDist = (avg * 1000).toFixed(4)
        let avgAbsDist = (avgAbs * 1000).toFixed(4)
        let maxPositive = (maxPos * 1000).toFixed(4)
        let maxNegative = (maxNeg * 1000).toFixed(4)
        let frameCount = 0
        if (isPlayingRef.current) {
          const st = statsRef.current
          st.frameCount += 1
          st.sumSignedDist += avg
          st.sumAbsDist += avgAbs
          if (maxPos > st.maxPositive) st.maxPositive = maxPos
          if (maxNeg < st.maxNegative) st.maxNegative = maxNeg
          avgSignedDist = ((st.sumSignedDist / st.frameCount) * 1000).toFixed(4)
          avgAbsDist = ((st.sumAbsDist / st.frameCount) * 1000).toFixed(4)
          maxPositive = (st.maxPositive * 1000).toFixed(4)
          maxNegative = (st.maxNegative * 1000).toFixed(4)
          frameCount = st.frameCount
        }
        onMatchUpdateRef.current?.({
          avgSignedDist,
          avgAbsDist,
          maxPositive,
          maxNegative,
          dataMin: (dataMin * 1000).toFixed(4),
          dataMax: (dataMax * 1000).toFixed(4),
          currentAvgSigned: (avg * 1000).toFixed(4),
          frameCount,
        })
        onHistogramUpdateRef.current?.(computeHistogram(dists, sMin, sMax, 20))
      }
    }

    engineRef.current.applyFrame = applyFrame
    engineRef.current.views = views

    const animate = () => {
      engineRef.current.raf = requestAnimationFrame(animate)
      const fi = readFrame(currentFrameRef.current, playbackFrameRef)
      if (fi !== lastFi) {
        lastFi = fi
        applyFrame(fi, false)
      }
      for (const v of Object.values(views)) {
        v.controls.update()
        v.renderer.render(v.scene, v.camera)
      }
    }
    animate()
    applyFrame(readFrame(currentFrameRef.current, playbackFrameRef), true)

    return () => {
      cancelAnimationFrame(engineRef.current.raf)
      ro.disconnect()
      for (const v of Object.values(views)) {
        v.controls.dispose()
        v.renderer.dispose()
        if (v.renderer.domElement.parentNode === v.mount) {
          v.mount.removeChild(v.renderer.domElement)
        }
      }
    }
  }, [bundle, dualMountRef, wireMountRef, heatMountRef])

  return null
}

export default function MetaHumanComparePanels({
  gtData,
  predData,
  serverBase,
  evalKey,
  currentFrame = 0,
  playbackFrameRef = null,
  isPlaying = false,
}) {
  const dualMountRef = useRef(null)
  const wireMountRef = useRef(null)
  const heatMountRef = useRef(null)

  const [bundle, setBundle] = useState(null)
  const [loadStatus, setLoadStatus] = useState('')
  const [loadError, setLoadError] = useState(null)
  const [engineReady, setEngineReady] = useState(false)

  const [showOverlayGt, setShowOverlayGt] = useState(true)
  const [showOverlayPred, setShowOverlayPred] = useState(true)
  const [wireframeOpacity, setWireframeOpacity] = useState(0.65)
  const [gtXOffset, setGtXOffset] = useState(-4)
  const [predXOffset, setPredXOffset] = useState(4)
  const [scaleOffset, setScaleOffset] = useState(1.0)
  const [matchInfo, setMatchInfo] = useState(DEFAULT_MATCH)
  const [histogramData, setHistogramData] = useState(null)
  const [globalRange, setGlobalRange] = useState({
    globalMin: -10,
    globalMax: 10,
    mean: 0,
    std: 0,
    scanned: false,
  })

  const loadKey = useMemo(
    () => `${evalKey}|${gtData?.frames}|${predData?.frames}`,
    [evalKey, gtData, predData],
  )

  useEffect(() => {
    if (!gtData || !predData) return undefined
    const ac = new AbortController()
    setBundle(null)
    setEngineReady(false)
    setLoadError(null)
    setGlobalRange((g) => ({ ...g, scanned: false }))

    loadRigCompareBundle({
      serverBase,
      gtData,
      predData,
      signal: ac.signal,
      onProgress: (msg) => setLoadStatus(String(msg)),
    })
      .then((b) => {
        setBundle(b)
        setLoadStatus(
          `Head+Teeth ${b.evalVertexCount?.toLocaleString()}v (전신 ${b.assets.V.toLocaleString()}v deform)`,
        )
        requestAnimationFrame(() => setEngineReady(true))

        const total = Math.min(gtData.frames, predData.frames)
        const runScan = () => {
          setGlobalRange(
            scanGlobalSignedRange(
              deformFrame,
              b.assets,
              b.gtFrames,
              b.predFrames,
              total,
              b.evalVertexCount || b.headVertexCount,
            ),
          )
        }
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(runScan, { timeout: 3000 })
        } else {
          window.setTimeout(runScan, 100)
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted) setLoadError(e.message)
      })

    return () => ac.abort()
  }, [loadKey, serverBase, gtData, predData])

  const globalMaxAbs = globalRange.scanned
    ? Math.max(Math.abs(globalRange.globalMin), Math.abs(globalRange.globalMax), 0.1)
    : 10
  const scaleMin = (-globalMaxAbs * scaleOffset) / 1000
  const scaleMax = (globalMaxAbs * scaleOffset) / 1000

  if (loadError) {
    return (
      <div className="p-4 text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg">
        RigLogic 비교 로드 실패: {loadError}
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="h-full min-h-[280px] flex items-center justify-center text-gray-400 text-sm">
        {loadStatus || 'RigLogic GT/Pred 준비 중...'}
      </div>
    )
  }

  return (
    <div className="space-y-3 h-full flex flex-col min-h-0">
      <p className="text-[10px] text-gray-500 shrink-0">{loadStatus}</p>

      {engineReady && (
        <RigLogicSharedEngine
          bundle={bundle}
          dualMountRef={dualMountRef}
          wireMountRef={wireMountRef}
          heatMountRef={heatMountRef}
          currentFrame={currentFrame}
          playbackFrameRef={playbackFrameRef}
          gtXOffset={gtXOffset}
          predXOffset={predXOffset}
          wireframeOpacity={wireframeOpacity}
          showGt={showOverlayGt}
          showPred={showOverlayPred}
          scaleMin={scaleMin}
          scaleMax={scaleMax}
          isPlaying={isPlaying}
          onMatchUpdate={setMatchInfo}
          onHistogramUpdate={setHistogramData}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 flex-1 min-h-0 min-h-[280px]">
        <div className="flex flex-col min-h-[260px] bg-white/5 rounded-lg border border-white/10 p-2 min-h-0">
          <h3 className="text-xs font-semibold text-white mb-1 shrink-0">GT vs Prediction</h3>
          <div className="grid grid-cols-2 gap-1 mb-1 text-[10px] shrink-0">
            <label className="text-green-400">
              GT X
              <input type="range" min="-12" max="12" step="1" value={gtXOffset} onChange={(e) => setGtXOffset(Number(e.target.value))} className="w-full h-1 accent-green-500" />
            </label>
            <label className="text-red-400">
              Pred X
              <input type="range" min="-12" max="12" step="1" value={predXOffset} onChange={(e) => setPredXOffset(Number(e.target.value))} className="w-full h-1 accent-red-500" />
            </label>
          </div>
          <div ref={dualMountRef} className="flex-1 min-h-0" />
        </div>

        <div className="flex flex-col min-h-[260px] bg-white/5 rounded-lg border border-white/10 p-2 min-h-0">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <h3 className="text-xs font-semibold text-white">와이어프레임</h3>
            <div className="flex gap-1">
              <button type="button" onClick={() => setShowOverlayGt((v) => !v)} className={`px-2 py-0.5 text-[10px] rounded ${showOverlayGt ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}`}>GT</button>
              <button type="button" onClick={() => setShowOverlayPred((v) => !v)} className={`px-2 py-0.5 text-[10px] rounded ${showOverlayPred ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-300'}`}>Pred</button>
            </div>
          </div>
          <label className="text-[10px] text-gray-400 mb-1 shrink-0 block">
            투명도
            <input type="range" min="0.1" max="1" step="0.05" value={wireframeOpacity} onChange={(e) => setWireframeOpacity(Number(e.target.value))} className="w-full h-1 accent-purple-500" />
          </label>
          <div ref={wireMountRef} className="flex-1 min-h-0" />
        </div>

        <div className="flex flex-col min-h-[260px] bg-white/5 rounded-lg border border-white/10 p-2 min-h-0">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <h3 className="text-xs font-semibold text-white">Signed Distance</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isPlaying ? 'text-green-400 bg-green-500/20' : 'text-gray-500 bg-gray-500/20'}`}>
              {isPlaying ? `F:${matchInfo.frameCount}` : '--'}
            </span>
          </div>
          <label className="text-[10px] text-purple-400 mb-1 shrink-0 block">
            Scale x{scaleOffset.toFixed(2)} [{(-globalMaxAbs * scaleOffset).toFixed(1)}, +{(globalMaxAbs * scaleOffset).toFixed(1)}] mm
            <input type="range" min="0.1" max="5" step="0.1" value={scaleOffset} onChange={(e) => setScaleOffset(Number(e.target.value))} className="w-full h-1 accent-purple-500" />
          </label>
          <div className="grid grid-cols-2 gap-1 text-[10px] mb-1 shrink-0">
            <div className="bg-green-500/20 rounded text-green-300 text-center py-0.5">
              {isPlaying ? `누적: ${matchInfo.avgSignedDist}` : `현재: ${matchInfo.currentAvgSigned}`}
            </div>
            <div className="bg-red-500/20 rounded text-red-300 text-center py-0.5">
              +Max: {matchInfo.maxPositive || matchInfo.dataMax}
            </div>
          </div>
          <div ref={heatMountRef} className="flex-1 min-h-0" />
        </div>
      </div>

      {histogramData?.normalizedBins && (
        <div className="shrink-0 p-2 bg-white/5 rounded-lg border border-white/10">
          <p className="text-[10px] text-gray-400 mb-1">Signed Distance Histogram (Head)</p>
          <div className="h-16 flex items-end gap-px bg-black/30 rounded p-1">
            {histogramData.normalizedBins.map((h, i) => (
              <div key={i} className="flex-1 bg-emerald-500/70 rounded-t min-w-[2px]" style={{ height: `${Math.max(4, h * 100)}%` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
