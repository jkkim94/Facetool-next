'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo } from 'react'
import { prepareArkitForGlbViewer } from '@/lib/eval/prepareArkitForGlb'

const DualFaceViewer = dynamic(() => import('@/components/training/DualFaceViewer'), { ssr: false })
const OverlayFaceViewer = dynamic(() => import('@/components/training/OverlayFaceViewer'), { ssr: false })
const HeatmapFaceViewer = dynamic(() => import('@/components/training/HeatmapFaceViewer'), { ssr: false })

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

/**
 * ARKit GLB — GT vs Pred + 와이어프레임 오버레이 + Signed Distance (TrainingView 3열 레이아웃)
 */
export default function ArkitComparePanels({
  gtData,
  predData,
  audioRef,
  isPlaying,
  playbackRate = 1,
  currentFrame = 0,
  glbUrl = '/models/face.glb',
}) {
  const [showOverlayGT, setShowOverlayGT] = useState(true)
  const [showOverlayPred, setShowOverlayPred] = useState(true)
  const [wireframeOpacity, setWireframeOpacity] = useState(0.6)
  const [gtXOffset, setGtXOffset] = useState(-3)
  const [predXOffset, setPredXOffset] = useState(3)
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

  const globalMaxAbs = globalRange.scanned
    ? Math.max(Math.abs(globalRange.globalMin), Math.abs(globalRange.globalMax), 0.1)
    : 10
  const scaleMin = -globalMaxAbs * scaleOffset
  const scaleMax = globalMaxAbs * scaleOffset

  const canCompare = Boolean(gtData && predData)

  const glbGtData = useMemo(
    () => (gtData ? prepareArkitForGlbViewer(gtData) : null),
    [gtData],
  )
  const glbPredData = useMemo(
    () => (predData ? prepareArkitForGlbViewer(predData) : null),
    [predData],
  )

  const panelKey = useMemo(
    () => `${glbGtData?.frames || 0}|${glbPredData?.frames || 0}|${glbUrl}`,
    [glbGtData, glbPredData, glbUrl],
  )

  return (
    <div className="space-y-3">
      {!canCompare && (
        <p className="text-xs text-gray-500 text-center">
          GT 로드됨 — 추론 후 와이어프레임 / Signed Distance 비교 가능
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* GT vs Pred */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex flex-col min-h-[280px]">
          <h3 className="text-sm font-semibold text-white mb-2">GT vs Prediction</h3>
          <div className="grid grid-cols-2 gap-1 mb-2 text-[10px]">
            <label className="text-green-400">
              GT X: {gtXOffset.toFixed(0)}
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={gtXOffset}
                onChange={(e) => setGtXOffset(parseFloat(e.target.value))}
                className="w-full h-1 accent-green-500"
              />
            </label>
            <label className="text-red-400">
              Pred X: {predXOffset.toFixed(0)}
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={predXOffset}
                onChange={(e) => setPredXOffset(parseFloat(e.target.value))}
                className="w-full h-1 accent-red-500"
              />
            </label>
          </div>
          <div className="flex-1 min-h-[220px] aspect-square max-h-[360px] mx-auto w-full">
            <DualFaceViewer
              key={`dual-${panelKey}`}
              gtData={glbGtData}
              trainingData={glbPredData}
              audioRef={audioRef}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              glbUrl={glbUrl}
              gtXOffset={gtXOffset}
              trainingXOffset={predXOffset}
              currentFrame={currentFrame}
            />
          </div>
        </div>

        {/* Wireframe overlay */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex flex-col min-h-[280px]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">와이어프레임</h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setShowOverlayGT((v) => !v)}
                className={`px-2 py-0.5 text-xs rounded-full ${showOverlayGT ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}`}
              >
                GT
              </button>
              <button
                type="button"
                onClick={() => setShowOverlayPred((v) => !v)}
                disabled={!predData}
                className={`px-2 py-0.5 text-xs rounded-full disabled:opacity-40 ${showOverlayPred ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-300'}`}
              >
                Pred
              </button>
            </div>
          </div>
          <label className="text-[10px] text-gray-400 mb-2 block">
            투명도: {wireframeOpacity.toFixed(1)}
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={wireframeOpacity}
              onChange={(e) => setWireframeOpacity(parseFloat(e.target.value))}
              className="w-full h-1 accent-purple-500"
            />
          </label>
          <div className="flex-1 min-h-[220px] aspect-square max-h-[360px] mx-auto w-full">
            {canCompare ? (
              <OverlayFaceViewer
                key={`overlay-${panelKey}`}
                gtData={glbGtData}
                trainingData={glbPredData}
                audioRef={audioRef}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                glbUrl={glbUrl}
                showGT={showOverlayGT}
                showTraining={showOverlayPred}
                opacity={wireframeOpacity}
                currentFrame={currentFrame}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                Pred 필요
              </div>
            )}
          </div>
        </div>

        {/* Signed Distance */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex flex-col min-h-[280px]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Signed Distance</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded ${isPlaying ? 'text-green-400 bg-green-500/20' : 'text-gray-500 bg-gray-500/20'}`}>
              {isPlaying ? `F:${matchInfo.frameCount}` : '--'}
            </span>
          </div>
          <label className="text-[10px] text-purple-400 mb-1 block">
            Scale x{scaleOffset.toFixed(2)} [{scaleMin.toFixed(1)}, +{scaleMax.toFixed(1)}] mm
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={scaleOffset}
              onChange={(e) => setScaleOffset(parseFloat(e.target.value))}
              className="w-full h-1 accent-purple-500"
              disabled={!canCompare}
            />
          </label>
          <div className="grid grid-cols-2 gap-1 text-[10px] mb-2">
            <div className="bg-green-500/20 px-1 py-0.5 rounded text-green-300 text-center">
              누적: {canCompare && isPlaying ? matchInfo.avgSignedDist : '--'}
            </div>
            <div className="bg-purple-500/20 px-1 py-0.5 rounded text-purple-300 text-center">
              |평균|: {canCompare && isPlaying ? matchInfo.avgAbsDist : '--'}
            </div>
            <div className="bg-red-500/20 px-1 py-0.5 rounded text-red-300 text-center">
              +Max: {canCompare && isPlaying ? matchInfo.maxPositive : '--'}
            </div>
            <div className="bg-blue-500/20 px-1 py-0.5 rounded text-blue-300 text-center">
              -Max: {canCompare && isPlaying ? matchInfo.maxNegative : '--'}
            </div>
          </div>
          <div className="flex-1 min-h-[220px] aspect-square max-h-[360px] mx-auto w-full">
            {canCompare ? (
              <HeatmapFaceViewer
                key={`heatmap-${panelKey}`}
                gtData={glbGtData}
                trainingData={glbPredData}
                audioRef={audioRef}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                glbUrl={glbUrl}
                scaleMin={scaleMin / 1000}
                scaleMax={scaleMax / 1000}
                onMatchUpdate={setMatchInfo}
                onHistogramUpdate={setHistogramData}
                onGlobalRangeUpdate={(range) => setGlobalRange({ ...range, scanned: true })}
                currentFrame={currentFrame}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                Pred 필요
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-gray-500">
            <span>{scaleMin.toFixed(1)}</span>
            <span>0</span>
            <span>+{scaleMax.toFixed(1)} mm</span>
          </div>
        </div>
      </div>

      {canCompare && histogramData?.normalizedBins && (
        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
          <p className="text-xs text-gray-300 font-medium mb-2">Signed Distance Histogram</p>
          <div className="relative h-24 bg-black/30 rounded-lg border border-white/10 p-2">
            <div className="flex items-end justify-between h-full gap-px">
              {histogramData.normalizedBins.map((height, index) => {
                const binCenter =
                  histogramData.minVal + (index + 0.5) * histogramData.binWidth
                const normalized =
                  binCenter /
                  Math.max(Math.abs(histogramData.minVal), Math.abs(histogramData.maxVal), 1e-6)
                let barColor = '#888'
                if (normalized >= 0) {
                  barColor =
                    normalized < 0.5
                      ? `rgb(${Math.round(normalized * 2 * 255)}, 255, 0)`
                      : `rgb(255, ${Math.round((1 - (normalized - 0.5) * 2) * 255)}, 0)`
                } else {
                  const absNorm = -normalized
                  barColor =
                    absNorm < 0.5
                      ? `rgb(0, 255, ${Math.round(absNorm * 2 * 255)})`
                      : `rgb(0, ${Math.round((1 - (absNorm - 0.5) * 2) * 255)}, 255)`
                }
                return (
                  <div
                    key={index}
                    className="flex-1 rounded-t min-w-[3px]"
                    style={{
                      height: `${Math.max(2, height * 100)}%`,
                      backgroundColor: barColor,
                    }}
                    title={`${histogramData.bins[index]} vertices`}
                  />
                )
              })}
            </div>
          </div>
          {globalRange.scanned && (
            <p className="text-[10px] text-gray-500 mt-1">
              Global range: [{globalRange.globalMin.toFixed(2)}, +{globalRange.globalMax.toFixed(2)}] mm
              · Mean {globalRange.mean.toFixed(2)} · Std {globalRange.std.toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
