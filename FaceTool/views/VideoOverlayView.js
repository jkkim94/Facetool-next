/**
 * ============================================================================
 * View: 비디오 오버레이 뷰 컴포넌트
 * ============================================================================
 * 
 * Epoch 학습 결과의 블렌드쉐이프를 DatasetGen 원본 비디오 프레임 위에
 * GT + 예측 두 개의 3D 메쉬로 오버레이하여 재생합니다.
 * 
 * 기능:
 * - 3분할 레이아웃: 얼굴 크롭 비디오 | GT 3D | 추론 3D
 * - 클립명 자동 추출 (CSV/GT 파일명에서)
 * - 오디오 동기 재생
 * - GT vs 예측 블렌드쉐이프 비교 패널
 * ============================================================================
 */

'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Model, TransparentBackground } from '@/components/common/ModelViewer'
import EpochFolderSelector from '@/components/training/EpochFolderSelector'

export default function VideoOverlayView({
  trainingData,
  trainingLoading,
  trainingError,
  metrics,
  gtData,
  gtLoading,
  gtError,
  audioRef,
  audioUrl,
  isPlaying,
  playbackRate = 1.0,
  onPlaybackRateChange,
  onEpochLoad,
  onPlay,
  onStop,
  onAudioEnded,
  currentFrame = 0,
  totalFrames = 0,
  fps = 30,
  onSeekToFrame,
}) {
  // 클립 매칭 상태
  const [clipName, setClipName] = useState('')
  const [clipSplit, setClipSplit] = useState('')
  const [frameInfo, setFrameInfo] = useState({ exists: false, frameCount: 0 })
  const [isMatchingClip, setIsMatchingClip] = useState(false)

  // 프레임 프리로드 상태
  const [preloadedImages, setPreloadedImages] = useState([])
  const [isPreloading, setIsPreloading] = useState(false)
  const [preloadProgress, setPreloadProgress] = useState(0)

  // 3D 모델 표시 상태
  const [showGT, setShowGT] = useState(true)
  const [showPred, setShowPred] = useState(true)

  // 기본 transform (각 패널 중앙용 - 단순화)
  const DEFAULT_TRANSFORM = { x: 0.0, y: -0.2, z: 4.5, scale: 1.0, rx: 0.0, ry: 0.0, rz: 0.0 }

  // GT / 예측 각각 독립적인 Transform
  const [gtTransform, setGtTransform] = useState(() => {
    try {
      const saved = localStorage.getItem('videoOverlay_gtTransform_v2')
      return saved ? JSON.parse(saved) : DEFAULT_TRANSFORM
    } catch { return DEFAULT_TRANSFORM }
  })
  const [predTransform, setPredTransform] = useState(() => {
    try {
      const saved = localStorage.getItem('videoOverlay_predTransform_v2')
      return saved ? JSON.parse(saved) : DEFAULT_TRANSFORM
    } catch { return DEFAULT_TRANSFORM }
  })

  // 얼굴 크롭 설정 (비디오 프레임)
  const DEFAULT_CROP = { zoom: 2.5, offsetX: 0, offsetY: -10 }
  const [faceCrop, setFaceCrop] = useState(() => {
    try {
      const saved = localStorage.getItem('videoOverlay_faceCrop')
      return saved ? JSON.parse(saved) : DEFAULT_CROP
    } catch { return DEFAULT_CROP }
  })
  const [showCropPanel, setShowCropPanel] = useState(false)

  // Transform / Crop 변경 시 localStorage에 자동 저장
  useEffect(() => {
    try { localStorage.setItem('videoOverlay_gtTransform_v2', JSON.stringify(gtTransform)) } catch {}
  }, [gtTransform])
  useEffect(() => {
    try { localStorage.setItem('videoOverlay_predTransform_v2', JSON.stringify(predTransform)) } catch {}
  }, [predTransform])
  useEffect(() => {
    try { localStorage.setItem('videoOverlay_faceCrop', JSON.stringify(faceCrop)) } catch {}
  }, [faceCrop])

  // 공통 설정
  const [glbPath, setGlbPath] = useState('/models/face.glb')
  const [showTransformPanel, setShowTransformPanel] = useState(false)
  const [transformTarget, setTransformTarget] = useState('gt') // 'gt' | 'pred'

  // GT vs 예측 비교 패널
  const [showCompare, setShowCompare] = useState(true)

  // metrics에서 클립명 자동 추출
  useEffect(() => {
    if (metrics?.clipName && metrics.clipName !== clipName) {
      console.log(`[VideoOverlay] 클립명 자동 설정: ${metrics.clipName}`)
      setClipName(metrics.clipName)
    }
  }, [metrics?.clipName])

  // 우리 데이터셋에서 추론한 경우: videoClipNameForFrames로 비디오 프레임 조회 (비디오 오버레이에 원본 영상 표시)
  const frameLookupName = metrics?.videoClipNameForFrames || clipName

  // 현재 프레임의 예측 블렌드쉐이프 데이터
  const getCurrentPredData = useCallback(() => {
    if (!trainingData?.data || !trainingData?.blendshapes) return null
    const frameData = trainingData.data[currentFrame]
    if (!frameData) return null
    const result = {}
    trainingData.blendshapes.forEach((name, i) => {
      result[name] = frameData[i] !== undefined ? frameData[i] : 0
    })
    return result
  }, [trainingData, currentFrame])

  // 현재 프레임의 GT 블렌드쉐이프 데이터
  const getCurrentGTData = useCallback(() => {
    if (!gtData?.data || !gtData?.blendshapes) return null
    const frameData = gtData.data[currentFrame]
    if (!frameData) return null
    const result = {}
    gtData.blendshapes.forEach((name, i) => {
      result[name] = frameData[i] !== undefined ? frameData[i] : 0
    })
    return result
  }, [gtData, currentFrame])

  // 클립명으로 프레임 폴더 확인
  const checkFrameFolder = useCallback(async (name) => {
    if (!name) return null
    setIsMatchingClip(true)
    try {
      const res = await fetch('/api/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const data = await res.json()
        setFrameInfo(data)
        if (data.split) setClipSplit(data.split)
        if (data.exists && data.framesDir) {
          console.log('[VideoOverlay] 비디오 오버레이 프레임 전체 폴더 경로:', data.framesDir)
        }
        return data
      }
    } catch (err) {
      console.error('[VideoOverlay] Frame folder check error:', err)
    } finally {
      setIsMatchingClip(false)
    }
    setFrameInfo({ exists: false, frameCount: 0 })
    return null
  }, [])

  // 프레임 이미지 프리로드
  const preloadFrames = useCallback(async (name, split, count) => {
    if (!name || count === 0) return
    setIsPreloading(true)
    setPreloadProgress(0)
    setPreloadedImages([])
    lastValidImageRef.current = null

    const images = []
    const batchSize = 20

    for (let i = 0; i < count; i += batchSize) {
      const batch = []
      const endIdx = Math.min(i + batchSize, count)
      for (let j = i; j < endIdx; j++) {
        const params = new URLSearchParams({ name, frame: j })
        if (split) params.set('split', split)
        const promise = new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = `/api/frames?${params.toString()}`
        })
        batch.push(promise)
      }
      const results = await Promise.all(batch)
      images.push(...results)
      setPreloadProgress(Math.round((images.length / count) * 100))
    }

    setPreloadedImages(images)
    setIsPreloading(false)
    console.log(`[VideoOverlay] ${images.filter(Boolean).length}/${count} frames loaded`)
  }, [])

  // 클립명 또는 데이터셋 비디오명(frameLookupName) 변경 시 프레임 확인 + 프리로드
  useEffect(() => {
    if (frameLookupName) {
      checkFrameFolder(frameLookupName).then((info) => {
        if (info?.exists && info.frameCount > 0) {
          preloadFrames(frameLookupName, info.split || '', info.frameCount)
        }
      })
    } else {
      setFrameInfo({ exists: false, frameCount: 0 })
      setPreloadedImages([])
      lastValidImageRef.current = null
    }
  }, [frameLookupName])

  // 현재 프레임 이미지 (범위 초과 방지 + null 프레임 시 마지막 유효 프레임 유지)
  const lastValidImageRef = useRef(null)
  const rawImage = currentFrame < preloadedImages.length ? preloadedImages[currentFrame] : null
  if (rawImage) lastValidImageRef.current = rawImage
  const currentImage = rawImage || lastValidImageRef.current

  // 비교할 블렌드쉐이프 이름 (GT & 예측 공통, 상위 20개)
  const compareBlendshapes = useCallback(() => {
    if (!trainingData?.blendshapes || !gtData?.blendshapes) return []
    return trainingData.blendshapes.filter(name =>
      gtData.blendshapes.includes(name) && !name.startsWith('jaw_') && !name.startsWith('eye_')
    ).slice(0, 20)
  }, [trainingData, gtData])

  // 프리로드된 프레임이 하나라도 있으면 비디오 모드 (안정적 - 매 프레임마다 바뀌지 않음)
  const hasVideoFrames = preloadedImages.length > 0 && preloadedImages.some(img => img !== null)
  const hasAnyData = trainingData || gtData

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-full mx-auto">
        {/* 재생 컨트롤 + 메트릭 */}
        <div className="mb-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-2xl p-4 border border-blue-500/20">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* 재생 컨트롤 */}
            <div className="flex items-center gap-3">
              <button
                onClick={onPlay}
                disabled={trainingLoading || !trainingData || isPlaying}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:opacity-50 text-white rounded-lg font-medium transition text-sm"
              >
                {isPlaying ? '재생 중...' : '재생'}
              </button>
              <button
                onClick={onStop}
                disabled={!isPlaying}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:opacity-50 text-white rounded-lg font-medium transition text-sm"
              >
                정지
              </button>

              <div className="px-3 py-1.5 bg-black/30 rounded-lg border border-white/10 font-mono text-sm">
                <span className="text-gray-400">Frame: </span>
                <span className="text-cyan-400">{currentFrame}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-gray-300">{totalFrames > 0 ? totalFrames - 1 : 0}</span>
                <span className="text-gray-500 ml-2">({fps}fps)</span>
              </div>

              <div className="flex items-center gap-1 px-3 py-1 bg-black/20 rounded-lg border border-white/10">
                <span className="text-xs text-gray-400">속도:</span>
                {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => {
                      onPlaybackRateChange(rate)
                      if (audioRef?.current) audioRef.current.playbackRate = rate
                    }}
                    className={`px-2 py-0.5 text-xs rounded transition ${
                      playbackRate === rate ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowCompare(!showCompare)}
                className={`px-3 py-1.5 text-xs rounded-lg transition ${
                  showCompare ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                비교 패널
              </button>
            </div>

            {/* 메트릭 */}
            {metrics && (
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center">
                  <p className="text-xs text-gray-400">Epoch</p>
                  <p className="text-base font-bold text-white">{metrics.folderName || '-'}</p>
                </div>
                <div className="h-6 w-px bg-white/20"></div>
                {metrics.clipName && (
                  <>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Clip</p>
                      <p className="text-xs font-mono text-green-400 max-w-[200px] truncate" title={metrics.clipName}>{metrics.clipName}</p>
                    </div>
                    <div className="h-6 w-px bg-white/20"></div>
                  </>
                )}
                <div className="text-center">
                  <p className="text-xs text-gray-400">Test LVE</p>
                  <p className="text-sm font-mono font-bold text-cyan-400">
                    {metrics.lve != null ? metrics.lve.toExponential(2) : '-'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Test LVD</p>
                  <p className="text-sm font-mono font-bold text-cyan-400">
                    {metrics.lvd != null ? metrics.lvd.toFixed(5) : '-'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 프레임 매칭 상태 표시 */}
          {clipName && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-gray-500">프레임:</span>
              {isMatchingClip ? (
                <span className="text-yellow-400">검색 중...</span>
              ) : frameInfo.exists ? (
                <>
                  <span className="text-green-400">OK {frameInfo.frameCount}장</span>
                  {clipSplit && <span className="text-blue-400">[{clipSplit}]</span>}
                  {isPreloading && <span className="text-yellow-400">로딩 {preloadProgress}%</span>}
                </>
              ) : (
                <span className="text-yellow-400">프레임 미발견 - 3D만 표시</span>
              )}
            </div>
          )}
        </div>

        {/* 메인: 3분할 - 얼굴크롭 | GT 3D | 추론 3D */}
        <div className="mb-4 flex gap-2" style={{ minHeight: '60vh' }}>

          {/* ===== 패널 1: 얼굴 크롭 비디오 ===== */}
          <div className="flex-1 bg-white/5 rounded-2xl p-3 border border-white/10 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <h2 className="text-sm font-semibold text-blue-400">Video (Face Crop)</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowCropPanel(!showCropPanel)}
                  className={`px-2 py-0.5 text-xs rounded transition ${
                    showCropPanel ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  }`}
                >
                  Crop
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 relative bg-black rounded-lg overflow-hidden">
              {/* 프리로드 진행 */}
              {isPreloading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-10">
                  <div className="text-white text-sm mb-2">프레임 로딩...</div>
                  <div className="w-40 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${preloadProgress}%` }} />
                  </div>
                  <div className="text-gray-400 text-xs mt-1">{preloadProgress}%</div>
                </div>
              )}
              {/* 얼굴 크롭 이미지 */}
              {!isPreloading && currentImage && (
                <div className="w-full h-full overflow-hidden flex items-center justify-center">
                  <img
                    src={currentImage.src}
                    alt={`Frame ${currentFrame}`}
                    draggable={false}
                    style={{
                      transform: `scale(${faceCrop.zoom}) translate(${faceCrop.offsetX}%, ${faceCrop.offsetY}%)`,
                      transformOrigin: 'center center',
                      maxWidth: 'none',
                      maxHeight: 'none',
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                </div>
              )}
              {/* 프레임 없을 때 */}
              {!isPreloading && !currentImage && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
                  {hasAnyData ? '프레임 미발견' : 'Epoch 로드 대기'}
                </div>
              )}
              {/* 프레임 정보 */}
              <div className="absolute top-1 left-1 bg-black/70 text-white px-1.5 py-0.5 rounded text-[10px] font-mono z-10">
                {isPlaying && <span className="text-green-400 mr-1">PLAY</span>}
                {currentFrame}/{totalFrames > 0 ? totalFrames - 1 : 0}
                <span className="ml-1 text-gray-400">({playbackRate}x)</span>
              </div>
              {clipName && (
                <div className="absolute top-1 right-1 bg-black/70 text-green-400 px-1.5 py-0.5 rounded text-[10px] z-10 max-w-full truncate">
                  {clipName}
                </div>
              )}
              {/* Crop 조절 패널 */}
              {showCropPanel && (
                <div className="absolute bottom-1 left-1 right-1 bg-black/90 text-white px-2 py-2 rounded text-xs z-20">
                  {[
                    { key: 'zoom', label: 'Zoom', min: 1, max: 6, step: 0.1, color: 'text-blue-400' },
                    { key: 'offsetX', label: 'X', min: -50, max: 50, step: 1, color: 'text-green-400' },
                    { key: 'offsetY', label: 'Y', min: -50, max: 50, step: 1, color: 'text-yellow-400' },
                  ].map(({ key, label, min, max, step, color }) => (
                    <div key={key} className="flex items-center gap-2 mb-1">
                      <span className="text-gray-400 w-10">{label}</span>
                      <input type="range" min={min} max={max} step={step} value={faceCrop[key]}
                        onChange={(e) => setFaceCrop(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                        className="flex-1 h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                      <input type="number" step={step} value={faceCrop[key]}
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setFaceCrop(prev => ({ ...prev, [key]: v })) }}
                        className={`w-14 px-1 py-0.5 text-right font-mono text-[10px] bg-black/60 border border-gray-600 rounded ${color} outline-none`} />
                    </div>
                  ))}
                  <button onClick={() => setFaceCrop(DEFAULT_CROP)}
                    className="mt-1 w-full px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 rounded">리셋</button>
                </div>
              )}
            </div>
          </div>

          {/* ===== 패널 2: GT 3D 모델 ===== */}
          <div className="flex-1 bg-white/5 rounded-2xl p-3 border border-green-900/30 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <h2 className="text-sm font-semibold text-green-400">GT (Ground Truth)</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setTransformTarget('gt'); setShowTransformPanel(!showTransformPanel || transformTarget !== 'gt') }}
                  className={`px-2 py-0.5 text-xs rounded transition ${
                    showTransformPanel && transformTarget === 'gt' ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  }`}
                >
                  Transform
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 relative bg-black rounded-lg overflow-hidden">
              {showGT && gtData ? (
                <Canvas
                  key={`gt-model-${glbPath}`}
                  camera={{ position: [0, 0, 5], fov: 50 }}
                  gl={{ preserveDrawingBuffer: true, alpha: true }}
                >
                  <Suspense fallback={null}>
                    <color attach="background" args={['#111']} />
                    <ambientLight intensity={0.7} />
                    <hemisphereLight args={['#ffffff', '#444444', 0.6]} />
                    <directionalLight position={[0, 8, 10]} intensity={0.8} />
                    <directionalLight position={[-5, 4, 5]} intensity={0.4} />
                    <directionalLight position={[5, 4, 5]} intensity={0.4} />
                    <Model
                      glbPath={glbPath}
                      viewerId="gt"
                      blendshapeData={getCurrentGTData()}
                      blendshapeNames={gtData?.blendshapes || []}
                      position={[gtTransform.x, gtTransform.y, gtTransform.z]}
                      scale={gtTransform.scale}
                      rotation={[gtTransform.rx, gtTransform.ry, gtTransform.rz]}
                    />
                    <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
                  </Suspense>
                </Canvas>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
                  GT 데이터 없음
                </div>
              )}
            </div>
          </div>

          {/* ===== 패널 3: 추론 3D 모델 ===== */}
          <div className="flex-1 bg-white/5 rounded-2xl p-3 border border-red-900/30 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <h2 className="text-sm font-semibold text-red-400">Prediction (추론)</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setTransformTarget('pred'); setShowTransformPanel(!showTransformPanel || transformTarget !== 'pred') }}
                  className={`px-2 py-0.5 text-xs rounded transition ${
                    showTransformPanel && transformTarget === 'pred' ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  }`}
                >
                  Transform
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 relative bg-black rounded-lg overflow-hidden">
              {showPred && trainingData ? (
                <Canvas
                  key={`pred-model-${glbPath}`}
                  camera={{ position: [0, 0, 5], fov: 50 }}
                  gl={{ preserveDrawingBuffer: true, alpha: true }}
                >
                  <Suspense fallback={null}>
                    <color attach="background" args={['#111']} />
                    <ambientLight intensity={0.7} />
                    <hemisphereLight args={['#ffffff', '#444444', 0.6]} />
                    <directionalLight position={[0, 8, 10]} intensity={0.8} />
                    <directionalLight position={[-5, 4, 5]} intensity={0.4} />
                    <directionalLight position={[5, 4, 5]} intensity={0.4} />
                    <Model
                      glbPath={glbPath}
                      viewerId="pred"
                      blendshapeData={getCurrentPredData()}
                      blendshapeNames={trainingData?.blendshapes || []}
                      position={[predTransform.x, predTransform.y, predTransform.z]}
                      scale={predTransform.scale}
                      rotation={[predTransform.rx, predTransform.ry, predTransform.rz]}
                    />
                    <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
                  </Suspense>
                </Canvas>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
                  추론 데이터 없음
                </div>
              )}
            </div>
          </div>

          {/* ===== Transform 패널 (플로팅) ===== */}
          {showTransformPanel && (() => {
            const isGT = transformTarget === 'gt'
            const t = isGT ? gtTransform : predTransform
            const setT = isGT ? setGtTransform : setPredTransform

            return (
              <div className="fixed top-20 right-6 bg-gray-900/95 text-white px-3 py-2 rounded-lg text-xs z-50 w-60 border border-white/10 shadow-xl">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">Transform - <span className={isGT ? 'text-green-400' : 'text-red-400'}>{isGT ? 'GT' : '추론'}</span></span>
                  <button onClick={() => setShowTransformPanel(false)} className="text-gray-400 hover:text-white">x</button>
                </div>

                {/* GT / 예측 탭 */}
                <div className="flex gap-1 mb-3">
                  <button
                    onClick={() => setTransformTarget('gt')}
                    className={`flex-1 py-1 text-xs font-medium rounded transition ${
                      transformTarget === 'gt' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >GT</button>
                  <button
                    onClick={() => setTransformTarget('pred')}
                    className={`flex-1 py-1 text-xs font-medium rounded transition ${
                      transformTarget === 'pred' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >추론</button>
                </div>

                {/* Position */}
                {[
                  { key: 'x', label: 'X', color: 'text-blue-400', min: -10, max: 10 },
                  { key: 'y', label: 'Y', color: 'text-green-400', min: -10, max: 10 },
                  { key: 'z', label: 'Z', color: 'text-yellow-400', min: -10, max: 10 },
                ].map(({ key, label, color, min, max }) => (
                  <div key={`pos-${key}`} className="mb-1">
                    <div className="flex justify-between items-center gap-1">
                      <span className="text-gray-400 whitespace-nowrap">Pos {label}</span>
                      <input type="number" step="0.01" value={t[key]}
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setT(prev => ({ ...prev, [key]: v })) }}
                        className={`w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded ${color} focus:border-blue-400 outline-none`} />
                    </div>
                    <input type="range" min={min} max={max} step="0.01" value={t[key]}
                      onChange={(e) => setT(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                  </div>
                ))}
                {/* Scale */}
                <div className="mb-1">
                  <div className="flex justify-between items-center gap-1">
                    <span className="text-gray-400">Scale</span>
                    <input type="number" step="0.01" min="0.01" value={t.scale}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setT(prev => ({ ...prev, scale: v })) }}
                      className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-purple-400 focus:border-blue-400 outline-none" />
                  </div>
                  <input type="range" min="0.1" max="5" step="0.01" value={t.scale}
                    onChange={(e) => setT(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                </div>
                {/* Rotation */}
                {[
                  { key: 'rx', label: 'X' },
                  { key: 'ry', label: 'Y' },
                  { key: 'rz', label: 'Z' },
                ].map(({ key, label }) => (
                  <div key={`rot-${key}`} className="mb-1">
                    <div className="flex justify-between items-center gap-1">
                      <span className="text-gray-400">Rot {label}</span>
                      <input type="number" step="0.01" value={t[key]}
                        onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setT(prev => ({ ...prev, [key]: v })) }}
                        className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-orange-400 focus:border-blue-400 outline-none" />
                    </div>
                    <input type="range" min="-3.14" max="3.14" step="0.01" value={t[key]}
                      onChange={(e) => setT(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                  </div>
                ))}
                {/* 액션 */}
                <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                  <button onClick={() => { if (isGT) setPredTransform({ ...gtTransform }); else setGtTransform({ ...predTransform }) }}
                    className="w-full px-2 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 rounded text-white">
                    {isGT ? '이 값을 추론에 복사' : '이 값을 GT에 복사'}
                  </button>
                  <button onClick={() => setT(DEFAULT_TRANSFORM)}
                    className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">기본값 복원</button>
                  <button onClick={() => { setGtTransform(DEFAULT_TRANSFORM); setPredTransform(DEFAULT_TRANSFORM) }}
                    className="w-full px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white">양쪽 리셋</button>
                </div>
                {/* GLB */}
                <div className="mt-2 pt-2 border-t border-white/10">
                  <span className="text-gray-500 text-[10px]">GLB (공통)</span>
                  <input type="text" value={glbPath} onChange={(e) => setGlbPath(e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-black/50 border border-gray-600 rounded text-white mb-1" />
                  <div className="flex gap-1">
                    <button onClick={() => setGlbPath('/models/face.glb')}
                      className="px-2 py-0.5 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">기본</button>
                    <label className="px-2 py-0.5 text-xs bg-purple-600 hover:bg-purple-500 rounded text-white cursor-pointer">
                      업로드
                      <input type="file" accept=".glb,.gltf" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) setGlbPath(URL.createObjectURL(f)) }} />
                    </label>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* 프레임 시크바 */}
        {totalFrames > 0 && (
          <div className="mb-4">
            <input type="range" min="0" max={totalFrames - 1} value={currentFrame}
              onChange={(e) => onSeekToFrame && onSeekToFrame(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
          </div>
        )}

        {/* GT vs 예측 블렌드쉐이프 비교 패널 */}
        {showCompare && (trainingData || gtData) && (
          <div className="mb-4 bg-white/5 rounded-2xl p-4 border border-white/10">
            <h2 className="text-sm font-semibold text-white mb-2">GT vs 예측 블렌드쉐이프 비교</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 max-h-40 overflow-y-auto pr-1">
              {compareBlendshapes().map((name) => {
                const gtVal = getCurrentGTData()?.[name] || 0
                const predVal = getCurrentPredData()?.[name] || 0
                const diff = Math.abs(gtVal - predVal)
                const maxVal = Math.max(Math.abs(gtVal), Math.abs(predVal), 0.01)

                return (
                  <div key={name} className="text-xs">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-gray-400 truncate max-w-[100px]" title={name}>
                        {name.replace('exp_', 'E').replace(/^0+/, '')}
                      </span>
                      <span className={`font-mono ${diff > 0.1 ? 'text-red-400' : 'text-gray-500'}`}>
                        {diff.toFixed(3)}
                      </span>
                    </div>
                    <div className="flex gap-1 items-center">
                      <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full bg-green-500/60 rounded"
                          style={{ width: `${Math.min(100, Math.abs(gtVal) / maxVal * 100)}%` }} />
                      </div>
                      <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full bg-red-500/60 rounded"
                          style={{ width: `${Math.min(100, Math.abs(predVal) / maxVal * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
              {compareBlendshapes().length === 0 && (
                <div className="col-span-full text-gray-500 text-center py-2 text-xs">
                  GT와 예측 데이터를 모두 로드하면 비교가 표시됩니다
                </div>
              )}
            </div>
            <div className="mt-2 pt-2 border-t border-white/10 flex gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded"></span>GT
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded"></span>예측
              </span>
              <button onClick={() => setShowCompare(false)} className="ml-auto text-gray-500 hover:text-white text-xs">닫기</button>
            </div>
          </div>
        )}

        {/* 하단: Epoch 선택 */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <EpochFolderSelector
            onEpochLoad={onEpochLoad}
            disabled={trainingLoading}
          />

          {trainingLoading && (
            <div className="text-center mt-4">
              <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 mt-2">로딩 중...</p>
            </div>
          )}

          {audioUrl && (
            <audio key={audioUrl} ref={audioRef} src={audioUrl} preload="auto" onEnded={onAudioEnded} className="hidden" />
          )}
        </div>
      </div>
    </main>
  )
}
