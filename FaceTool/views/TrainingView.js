/**
 * ============================================================================
 * View: 학습 모니터링 뷰 컴포넌트
 * ============================================================================
 */

'use client'

import { useState } from 'react'
import DualFaceViewer from '@/components/training/DualFaceViewer'
import OverlayFaceViewer from '@/components/training/OverlayFaceViewer'
import HeatmapFaceViewer from '@/components/training/HeatmapFaceViewer'
import EpochFolderSelector from '@/components/training/EpochFolderSelector'

export default function TrainingView({
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
  // 프레임 기반 재생 추가
  currentFrame = 0,
  totalFrames = 0,
  fps = 30,
  onSeekToFrame
}) {
  // 오버레이 뷰어 토글 상태
  const [showOverlayGT, setShowOverlayGT] = useState(true)
  const [showOverlayTraining, setShowOverlayTraining] = useState(true)
  
  // 2D/3D 카메라 모드 토글
  const [use2D, setUse2D] = useState(false)
  
  // 듀얼 뷰어 설정 (X축 위치)
  const [gtXOffset, setGtXOffset] = useState(-3)
  const [trainingXOffset, setTrainingXOffset] = useState(3)
  
  // 와이어프레임 투명도 설정
  const [wireframeOpacity, setWireframeOpacity] = useState(0.6)
  
  // 각 뷰어별 GLB 파일 설정
  const [glbSettings, setGlbSettings] = useState({
    viewer1: '/models/face.glb',  // GT vs 학습
    viewer2: '/models/face.glb',  // 와이어프레임
    viewer3: '/models/face.glb',  // 히트맵
  })
  const [showGlbSettings, setShowGlbSettings] = useState(false)
  
  // 히트맵 Signed Distance 통계 상태 (CloudCompare 스타일)
  const [matchInfo, setMatchInfo] = useState({ 
    avgSignedDist: '0',    // 전체 프레임 누적 평균 (signed)
    avgAbsDist: '0',       // 전체 프레임 누적 평균 (absolute)
    maxPositive: '0',      // 최대 양수 편차 (바깥쪽)
    maxNegative: '0',      // 최대 음수 편차 (안쪽)
    dataMin: '0',          // 현재 프레임 실제 최소값
    dataMax: '0',          // 현재 프레임 실제 최대값
    currentAvgSigned: '0', // 현재 프레임 평균
    frameCount: 0          // 처리된 프레임 수
  })
  
  // 히스토그램 데이터 상태
  const [histogramData, setHistogramData] = useState(null)
  
  // 전체 프레임 스캔 결과 (Epoch 로드 시 계산됨)
  const [globalRange, setGlobalRange] = useState({
    globalMin: -10,  // mm
    globalMax: 10,   // mm
    mean: 0,         // mm
    std: 0,          // mm
    totalFrames: 0,
    sampledFrames: 0,
    totalVertices: 0,
    scanned: false
  })
  
  // 스케일 offset (전체 프레임의 global max/min 기준 배율)
  // 1.0 = 데이터 범위 그대로, 0.5 = 절반(더 민감), 2.0 = 2배(덜 민감)
  const [scaleOffset, setScaleOffset] = useState(1.0)
  
  // 실제 스케일 값 (전체 프레임 global range * offset)
  const globalMaxAbs = globalRange.scanned 
    ? Math.max(Math.abs(globalRange.globalMin), Math.abs(globalRange.globalMax), 0.1)
    : 10  // 스캔 전 기본값
  const scaleMin = -globalMaxAbs * scaleOffset
  const scaleMax = globalMaxAbs * scaleOffset

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-full mx-auto">
        <div className="flex items-center justify-center gap-4 mb-2">
          <h1 className="text-3xl font-bold text-center text-white">
            학습 결과 모니터링
          </h1>
          {/* 2D/3D 토글 버튼 */}
          <button
            onClick={() => setUse2D(!use2D)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              use2D 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            {use2D ? '2D' : '3D'}
          </button>
          {/* GLB 설정 버튼 */}
          <button
            onClick={() => setShowGlbSettings(!showGlbSettings)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              showGlbSettings 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            GLB 설정
          </button>
        </div>
        <p className="text-center text-gray-400 mb-4">
          에폭별 학습 결과를 확인하고 비교합니다
        </p>

        {/* LVE/LVD 메트릭 표시 + 재생 컨트롤 */}
        <div className="mb-6 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-2xl p-4 border border-purple-500/20">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* 왼쪽: 재생 컨트롤 */}
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
              
              {/* 프레임 정보 표시 */}
              <div className="px-3 py-1.5 bg-black/30 rounded-lg border border-white/10 font-mono text-sm">
                <span className="text-gray-400">Frame: </span>
                <span className="text-cyan-400">{currentFrame}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-gray-300">{totalFrames - 1}</span>
                <span className="text-gray-500 ml-2">({fps}fps)</span>
              </div>
              
              {/* 재생속도 조절 */}
              <div className="flex items-center gap-1 px-3 py-1 bg-black/20 rounded-lg border border-white/10">
                <span className="text-xs text-gray-400">속도:</span>
                {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => {
                      onPlaybackRateChange(rate)
                      if (audioRef?.current) {
                        audioRef.current.playbackRate = rate
                      }
                    }}
                    className={`px-2 py-0.5 text-xs rounded transition ${
                      playbackRate === rate
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
            
            {/* 중앙/오른쪽: 메트릭 */}
            {metrics && (
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center">
                  <p className="text-xs text-gray-400">Epoch</p>
                  <p className="text-base font-bold text-white">{metrics.folderName || '-'}</p>
                </div>
                <div className="h-6 w-px bg-white/20"></div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Test LVE</p>
                  <p className="text-sm font-mono font-bold text-cyan-400">
                    {metrics.lve !== null && metrics.lve !== undefined 
                      ? metrics.lve.toExponential(2) 
                      : '-'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Test LVD</p>
                  <p className="text-sm font-mono font-bold text-cyan-400">
                    {metrics.lvd !== null && metrics.lvd !== undefined 
                      ? metrics.lvd.toFixed(5) 
                      : '-'}
                  </p>
                </div>
                <div className="h-6 w-px bg-white/20"></div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Val LVE</p>
                  <p className="text-sm font-mono font-bold text-green-400">
                    {metrics.valLve !== null && metrics.valLve !== undefined 
                      ? metrics.valLve.toExponential(2) 
                      : '-'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Val LVD</p>
                  <p className="text-sm font-mono font-bold text-green-400">
                    {metrics.valLvd !== null && metrics.valLvd !== undefined 
                      ? metrics.valLvd.toFixed(5) 
                      : '-'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* GLB 설정 패널 */}
        {showGlbSettings && (
          <div className="mb-6 bg-purple-500/10 rounded-2xl p-4 border border-purple-500/20">
            <p className="text-sm text-purple-300 font-medium mb-3">각 뷰어별 GLB 파일 설정</p>
            <div className="grid grid-cols-3 gap-4">
              {/* 뷰어 1: GT vs 학습 */}
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2">1. GT vs 학습</p>
                <input
                  type="text"
                  value={glbSettings.viewer1}
                  onChange={(e) => setGlbSettings(prev => ({ ...prev, viewer1: e.target.value }))}
                  placeholder="/models/face.glb"
                  className="w-full px-2 py-1 text-xs bg-black/30 border border-gray-600 rounded text-white"
                />
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => setGlbSettings(prev => ({ ...prev, viewer1: '/models/face.glb' }))}
                    className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                  >
                    기본
                  </button>
                  <label className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded text-white cursor-pointer">
                    업로드
                    <input
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const url = URL.createObjectURL(file)
                          setGlbSettings(prev => ({ ...prev, viewer1: url }))
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              
              {/* 뷰어 2: 와이어프레임 */}
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2">2. 와이어프레임</p>
                <input
                  type="text"
                  value={glbSettings.viewer2}
                  onChange={(e) => setGlbSettings(prev => ({ ...prev, viewer2: e.target.value }))}
                  placeholder="/models/face.glb"
                  className="w-full px-2 py-1 text-xs bg-black/30 border border-gray-600 rounded text-white"
                />
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => setGlbSettings(prev => ({ ...prev, viewer2: '/models/face.glb' }))}
                    className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                  >
                    기본
                  </button>
                  <label className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded text-white cursor-pointer">
                    업로드
                    <input
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const url = URL.createObjectURL(file)
                          setGlbSettings(prev => ({ ...prev, viewer2: url }))
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              
              {/* 뷰어 3: 히트맵 */}
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2">3. 히트맵</p>
                <input
                  type="text"
                  value={glbSettings.viewer3}
                  onChange={(e) => setGlbSettings(prev => ({ ...prev, viewer3: e.target.value }))}
                  placeholder="/models/face.glb"
                  className="w-full px-2 py-1 text-xs bg-black/30 border border-gray-600 rounded text-white"
                />
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => setGlbSettings(prev => ({ ...prev, viewer3: '/models/face.glb' }))}
                    className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                  >
                    기본
                  </button>
                  <label className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded text-white cursor-pointer">
                    업로드
                    <input
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const url = URL.createObjectURL(file)
                          setGlbSettings(prev => ({ ...prev, viewer3: url }))
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              
            </div>
            
            {/* 일괄 적용 */}
            <div className="mt-3 flex items-center gap-2">
              <label className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 rounded text-white cursor-pointer">
                전체 뷰어에 동일 GLB 적용
                <input
                  type="file"
                  accept=".glb,.gltf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const url = URL.createObjectURL(file)
                      setGlbSettings({
                        viewer1: url,
                        viewer2: url,
                        viewer3: url,
                      })
                    }
                  }}
                />
              </label>
              <button
                onClick={() => setGlbSettings({
                  viewer1: '/models/face.glb',
                  viewer2: '/models/face.glb',
                  viewer3: '/models/face.glb',
                })}
                className="px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
              >
                전체 기본값 복원
              </button>
            </div>
          </div>
        )}

        {/* 3D 뷰어 그리드 - 1x3 */}
        <div className="mb-6">
          <div className="grid grid-cols-3 gap-4">
            {/* 1. GT vs 학습결과 */}
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col">
              {/* 고정 높이 컨트롤 영역 */}
              <div className="h-24 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-white">GT vs 학습결과</h2>
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  </div>
                </div>
                
                {/* X축 위치 조절 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-500/10 rounded px-2 py-1 border border-green-500/20">
                    <label className="text-xs text-green-400">GT: {gtXOffset.toFixed(0)}</label>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="1"
                      value={gtXOffset}
                      onChange={(e) => setGtXOffset(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer accent-green-500"
                    />
                  </div>
                  <div className="bg-red-500/10 rounded px-2 py-1 border border-red-500/20">
                    <label className="text-xs text-red-400">학습: {trainingXOffset.toFixed(0)}</label>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="1"
                      value={trainingXOffset}
                      onChange={(e) => setTrainingXOffset(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer accent-red-500"
                    />
                  </div>
                </div>
              </div>
              
              <div className="aspect-square">
                <DualFaceViewer
                  gtData={gtData}
                  trainingData={trainingData}
                  audioRef={audioRef}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  glbUrl={glbSettings.viewer1}
                  use2D={use2D}
                  gtXOffset={gtXOffset}
                  trainingXOffset={trainingXOffset}
                  currentFrame={currentFrame}
                />
              </div>
              
              {(gtError || trainingError) && (
                <div className="mt-2 p-1 bg-red-500/20 border border-red-500 rounded text-red-400 text-xs">
                  {gtError || trainingError}
                </div>
              )}
              {(gtLoading || trainingLoading) && (
                <div className="mt-2 text-center">
                  <div className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            {/* 2. 와이어프레임 오버레이 */}
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col">
              {/* 고정 높이 컨트롤 영역 */}
              <div className="h-24 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-white">와이어프레임</h2>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setShowOverlayGT(!showOverlayGT)}
                      className={`px-2 py-0.5 text-xs rounded-full transition ${
                        showOverlayGT 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-600 text-gray-300'
                      }`}
                    >
                      GT
                    </button>
                    <button
                      onClick={() => setShowOverlayTraining(!showOverlayTraining)}
                      className={`px-2 py-0.5 text-xs rounded-full transition ${
                        showOverlayTraining 
                          ? 'bg-red-600 text-white' 
                          : 'bg-gray-600 text-gray-300'
                      }`}
                    >
                      학습
                    </button>
                  </div>
                </div>
                
                {/* 투명도 슬라이더 */}
                <div className="bg-white/5 rounded px-2 py-1 border border-white/10">
                  <label className="text-xs text-gray-400">투명도: {wireframeOpacity.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={wireframeOpacity}
                    onChange={(e) => setWireframeOpacity(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer accent-purple-500"
                  />
                </div>
              </div>
              
              <div className="aspect-square">
                <OverlayFaceViewer
                  gtData={gtData}
                  trainingData={trainingData}
                  audioRef={audioRef}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  glbUrl={glbSettings.viewer2}
                  showGT={showOverlayGT}
                  showTraining={showOverlayTraining}
                  use2D={use2D}
                  opacity={wireframeOpacity}
                  currentFrame={currentFrame}
                />
              </div>
              
              <div className="mt-2 flex gap-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded"></span>GT
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-500 rounded"></span>학습
                </span>
              </div>
            </div>

            {/* 3. 히트맵 뷰어 (CloudCompare Signed Distance) */}
            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col">
              {/* 컨트롤 영역 */}
              <div className="flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-white">Signed Distance</h2>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    isPlaying ? 'text-green-400 bg-green-500/20' : 'text-gray-500 bg-gray-500/20'
                  }`}>
                    {isPlaying ? `F:${matchInfo.frameCount}` : '--'}
                  </span>
                </div>
                
                {/* 스케일 Offset 조절 (CloudCompare scalar field) */}
                <div className="bg-purple-500/10 rounded px-2 py-1 border border-purple-500/20 mb-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-purple-400">Scale Offset: x{scaleOffset.toFixed(2)}</label>
                    <span className="text-xs text-gray-500">
                      [{scaleMin.toFixed(1)}, +{scaleMax.toFixed(1)}] mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={scaleOffset}
                    onChange={(e) => setScaleOffset(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-600 mt-1">
                    <span>민감 (x0.1)</span>
                    <span className={globalRange.scanned ? 'text-green-500' : 'text-yellow-500'}>
                      {globalRange.scanned 
                        ? `Global: [${globalRange.globalMin.toFixed(1)}, +${globalRange.globalMax.toFixed(1)}]mm`
                        : 'Epoch 로드 대기...'
                      }
                    </span>
                    <span>둔감 (x5)</span>
                  </div>
                </div>
                
                {/* Global 통계 - Mean, Std (전체 프레임 스캔 결과) */}
                <div className="grid grid-cols-2 gap-1 text-xs mb-1">
                  <div className="bg-yellow-500/20 px-1 py-0.5 rounded text-yellow-300 text-center">
                    Mean: {globalRange.scanned ? `${globalRange.mean.toFixed(2)}mm` : '--'}
                  </div>
                  <div className="bg-orange-500/20 px-1 py-0.5 rounded text-orange-300 text-center">
                    Std: {globalRange.scanned ? `${globalRange.std.toFixed(2)}mm` : '--'}
                  </div>
                </div>
                
                {/* Signed Distance 정보 - CloudCompare 스타일 */}
                <div className="grid grid-cols-2 gap-1 text-xs mb-1">
                  <div className="bg-green-500/20 px-1 py-0.5 rounded text-green-300 text-center">
                    누적평균: {isPlaying ? matchInfo.avgSignedDist : '--'}
                  </div>
                  <div className="bg-purple-500/20 px-1 py-0.5 rounded text-purple-300 text-center">
                    |평균|: {isPlaying ? matchInfo.avgAbsDist : '--'}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="bg-red-500/20 px-1 py-0.5 rounded text-red-300 text-center">
                    +Max: {isPlaying ? matchInfo.maxPositive : '--'}
                  </div>
                  <div className="bg-blue-500/20 px-1 py-0.5 rounded text-blue-300 text-center">
                    -Max: {isPlaying ? matchInfo.maxNegative : '--'}
                  </div>
                </div>
              </div>
              
              <div className="aspect-square mt-2">
                <HeatmapFaceViewer
                  gtData={gtData}
                  trainingData={trainingData}
                  audioRef={audioRef}
                  isPlaying={isPlaying}
                  playbackRate={playbackRate}
                  glbUrl={glbSettings.viewer3}
                  scaleMin={scaleMin / 1000}
                  scaleMax={scaleMax / 1000}
                  onMatchUpdate={setMatchInfo}
                  onHistogramUpdate={setHistogramData}
                  onGlobalRangeUpdate={(range) => setGlobalRange({ ...range, scanned: true })}
                  use2D={use2D}
                  currentFrame={currentFrame}
                />
              </div>
              
              {/* CloudCompare 스타일 범례 - Signed Distance with scale values */}
              <div className="mt-2 flex justify-between text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: '#0000ff' }}></span>
                  <span>{scaleMin.toFixed(1)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: '#00ffff' }}></span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: '#00ff00' }}></span>
                  <span>0</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ffff00' }}></span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ff0000' }}></span>
                  <span>+{scaleMax.toFixed(1)}</span>
                </div>
              </div>
            </div>

          </div>
          
          {/* 수치 설명 - CloudCompare Signed Distance */}
          <div className="mt-4 p-4 bg-white/5 rounded-xl border border-white/10">
            <p className="text-sm text-gray-300 font-medium mb-3">CloudCompare C2C Signed Distance 알고리즘</p>
            
            {/* 수식 표시 */}
            <div className="mb-4 p-3 bg-black/30 rounded-lg border border-white/10">
              <p className="text-xs text-gray-500 mb-2">Algorithm: Cloud-to-Cloud (C2C) Distance with Sign</p>
              
              {/* Signed Distance 수식 */}
              <div className="mb-3 p-2 bg-black/20 rounded">
                <p className="text-xs text-gray-500 mb-1">1. Signed Distance (각 vertex별)</p>
                <p className="text-sm font-mono text-cyan-300">
                  d<sub>signed</sub> = (P<sub>pred</sub> - P<sub>gt</sub>) · N<sub>gt</sub>
                </p>
              </div>
              
              {/* Mean 수식 */}
              <div className="mb-3 p-2 bg-black/20 rounded">
                <p className="text-xs text-gray-500 mb-1">2. Mean (전체 vertex 평균)</p>
                <p className="text-sm font-mono text-yellow-300">
                  Mean = (1/n) * Σ d<sub>i</sub>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  n = 전체 vertex 수 × 샘플링된 프레임 수
                </p>
              </div>
              
              {/* Std 수식 */}
              <div className="mb-3 p-2 bg-black/20 rounded">
                <p className="text-xs text-gray-500 mb-1">3. Standard Deviation</p>
                <p className="text-sm font-mono text-orange-300">
                  Std = √( (1/n) * Σ d<sub>i</sub><sup>2</sup> - Mean<sup>2</sup> )
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  = √( E[X²] - E[X]² ) (분산의 제곱근)
                </p>
              </div>
              
              <div className="text-xs text-gray-400 space-y-1 mb-3">
                <p><span className="text-yellow-400">P<sub>pred</sub></span> : Predicted vertex position (Training result)</p>
                <p><span className="text-yellow-400">P<sub>gt</sub></span> : Ground Truth vertex position</p>
                <p><span className="text-yellow-400">N<sub>gt</sub></span> : GT vertex normal (radial from face center, 얼굴 중심 → vertex 방향)</p>
                <p><span className="text-yellow-400">·</span> : Dot product (내적) - 벡터의 방향성을 반영한 거리</p>
              </div>
              
              {/* 출처 */}
              <div className="p-2 bg-blue-500/10 rounded border border-blue-500/20">
                <p className="text-xs text-blue-300 font-medium mb-1">References:</p>
                <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                  <li>CloudCompare v2.13+ "Compute C2C Distance" with "signed distances" option</li>
                  <li>CloudCompare Wiki: <span className="text-blue-400">cloudcompare.org/doc/wiki/index.php/Distances_Computation</span></li>
                  <li>Girardeau-Montaut, D. (2006). "Détection de changement sur des données géométriques tridimensionnelles"</li>
                  <li>Hausdorff Distance 기반 Cloud-to-Cloud 알고리즘의 signed 확장</li>
                </ul>
                <p className="text-xs text-gray-500 mt-2">
                  Note: 본 구현은 vertex normal 방향을 기준으로 signed distance를 계산하며, 
                  양수(+)는 GT 대비 바깥쪽, 음수(-)는 안쪽 편차를 의미합니다.
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-6 gap-3 text-xs text-gray-400">
              <div>
                <span className="text-yellow-400 font-medium">Mean</span>
                <p className="mt-1">전체 샘플의 signed distance 평균. 편향(bias) 방향을 나타냄</p>
              </div>
              <div>
                <span className="text-orange-400 font-medium">Std</span>
                <p className="mt-1">표준편차. 오차의 분산 정도를 나타냄</p>
              </div>
              <div>
                <span className="text-green-400 font-medium">누적평균</span>
                <p className="mt-1">재생 중 실시간 누적 signed distance 평균</p>
              </div>
              <div>
                <span className="text-purple-400 font-medium">|평균|</span>
                <p className="mt-1">절대값 거리의 누적 평균 (방향 무관)</p>
              </div>
              <div>
                <span className="text-red-400 font-medium">+Max</span>
                <p className="mt-1">d &gt; 0: 최대 바깥쪽 편차</p>
              </div>
              <div>
                <span className="text-blue-400 font-medium">-Max</span>
                <p className="mt-1">d &lt; 0: 최대 안쪽 편차</p>
              </div>
            </div>
          </div>
          
          {/* 히스토그램 - CloudCompare 스타일 에러 분포 */}
          <div className="mt-4 p-4 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-300 font-medium">Signed Distance 분포 (Histogram)</p>
              {histogramData && (
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>Data Range: [{parseFloat(matchInfo.dataMin || 0).toFixed(2)}, {parseFloat(matchInfo.dataMax || 0).toFixed(2)}] mm</span>
                  <span>Vertices: {histogramData.total || 0}</span>
                </div>
              )}
            </div>
            
            {/* 히스토그램 바 차트 */}
            <div className="relative h-32 bg-black/30 rounded-lg border border-white/10 p-2">
              {histogramData && histogramData.normalizedBins ? (
                <div className="flex items-end justify-between h-full gap-px">
                  {histogramData.normalizedBins.map((height, index) => {
                    // 각 bin의 중심값 계산
                    const binCenter = histogramData.minVal + (index + 0.5) * histogramData.binWidth
                    // 중심값에 따른 색상 계산
                    const normalized = binCenter / Math.max(Math.abs(histogramData.minVal), Math.abs(histogramData.maxVal))
                    let barColor
                    if (normalized >= 0) {
                      if (normalized < 0.5) {
                        barColor = `rgb(${Math.round(normalized * 2 * 255)}, 255, 0)`
                      } else {
                        barColor = `rgb(255, ${Math.round((1 - (normalized - 0.5) * 2) * 255)}, 0)`
                      }
                    } else {
                      const absNorm = -normalized
                      if (absNorm < 0.5) {
                        barColor = `rgb(0, 255, ${Math.round(absNorm * 2 * 255)})`
                      } else {
                        barColor = `rgb(0, ${Math.round((1 - (absNorm - 0.5) * 2) * 255)}, 255)`
                      }
                    }
                    
                    return (
                      <div
                        key={index}
                        className="flex-1 rounded-t transition-all duration-100"
                        style={{
                          height: `${Math.max(2, height * 100)}%`,
                          backgroundColor: barColor,
                          minWidth: '4px'
                        }}
                        title={`${((histogramData.minVal + index * histogramData.binWidth) * 1000).toFixed(2)} ~ ${((histogramData.minVal + (index + 1) * histogramData.binWidth) * 1000).toFixed(2)} mm: ${histogramData.bins[index]} vertices`}
                      />
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  재생 시작 시 히스토그램이 표시됩니다
                </div>
              )}
              
              {/* X축 레이블 */}
              <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-500 px-1" style={{ transform: 'translateY(100%)' }}>
                <span>{scaleMin.toFixed(1)}mm</span>
                <span>0</span>
                <span>+{scaleMax.toFixed(1)}mm</span>
              </div>
            </div>
            
            {/* 히스토그램 설명 */}
            <div className="mt-6 text-xs text-gray-500">
              <p>CloudCompare Scalar Field Histogram: 각 bin은 해당 signed distance 범위에 속하는 vertex 수를 나타냅니다.</p>
              <p>Min/Max 슬라이더로 색상 스케일 범위를 조절하여 세부 오차를 확인할 수 있습니다.</p>
            </div>
          </div>
        </div>

        {/* 컨트롤 패널 */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <div className="mb-6">
            <EpochFolderSelector 
              onEpochLoad={onEpochLoad}
              disabled={trainingLoading}
            />
          </div>

          {trainingLoading && (
            <div className="text-center mt-4">
              <div className="inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 mt-2">로딩 중...</p>
            </div>
          )}

          {/* 오디오 요소 (숨김) */}
          {audioUrl && (
            <audio
              key={audioUrl}
              ref={audioRef}
              src={audioUrl}
              preload="auto"
              onEnded={onAudioEnded}
              className="hidden"
            />
          )}
        </div>
      </div>
    </main>
  )
}
