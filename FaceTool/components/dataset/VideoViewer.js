'use client';

import { useState, useRef } from 'react';
import VideoPlayer from './VideoPlayer';
import ModelViewer from '@/components/common/ModelViewer';
import BlendshapeVisualizer from '@/components/common/BlendshapeVisualizer';

export default function VideoViewer({
  videoUrl,
  glbUrl,
  currentFrame,
  totalFrames,
  currentTime,
  currentBlendshapes,
  currentLandmarks,
  currentFrameImage, // 랜드마크가 그려진 프레임 이미지
  blendshapeNames,
  showLandmarks,
  showWireframe,
  onShowLandmarksChange,
  onShowWireframeChange,
  onPrevFrame,
  onNextFrame,
  videoRef,
  isProcessing,
  isPlaying = false,
  fps = 30,
  onVideoError,
}) {
  // 3D 모델 오버레이 투명도 조절만 (비디오는 배경으로 고정)
  const [modelOpacity, setModelOpacity] = useState(0.7); // 투명도 (0 ~ 1)
  const [showModelControls, setShowModelControls] = useState(true);

  return (
    <div className="flex-1 min-h-0 flex gap-4 mb-4">
      {/* 왼쪽: 비디오 플레이어 + 3D 모델 오버레이 */}
      <div className="flex-[19] bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-2 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-200">입력 비디오 + 3D 모델 동기화 검증</h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showLandmarks}
                onChange={(e) => onShowLandmarksChange(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>Landmark</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showWireframe}
                onChange={(e) => onShowWireframeChange(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>Wireframe</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showModelControls}
                onChange={(e) => setShowModelControls(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>3D 컨트롤</span>
            </label>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          {/* 비디오 플레이어 */}
          <VideoPlayer
            videoPath={videoUrl}
            currentTime={currentTime}
            isPlaying={false}
            playbackRate={1.0}
            onTimeUpdate={() => {}}
            onPlay={() => {}}
            onPause={() => {}}
            onLoadedMetadata={() => {}}
            onError={onVideoError}
            videoRef={videoRef}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
          />
          {/* 랜드마크가 그려진 프레임 이미지 오버레이 */}
          {showLandmarks && currentFrameImage && (
            <img
              src={currentFrameImage}
              alt="Landmarks"
              className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none z-10"
              style={{ imageRendering: 'auto' }}
            />
          )}
          {/* 3D 모델 오버레이 (비디오 배경 위에) */}
          {glbUrl && (
            <div
              className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
              style={{
                opacity: modelOpacity,
              }}
            >
              <ModelViewer
                viewerId="overlay-model"
                glbPath={glbUrl}
                cameraType="perspective"
                blendshapeData={currentBlendshapes}
                blendshapeNames={blendshapeNames || []}
                showWireframe={showWireframe}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
              />
            </div>
          )}
          {/* 프레임 번호 표시 - 좌상단 */}
          <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs font-mono z-30">
            Frame: {currentFrame + 1} / {totalFrames}
          </div>
          {/* 3D 모델 투명도 조절 컨트롤 */}
          {showModelControls && glbUrl && (
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-80 text-white p-2 rounded text-xs z-30">
              <div className="flex items-center gap-2">
                <label className="w-20">3D 모델 투명도:</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={modelOpacity}
                  onChange={(e) => setModelOpacity(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="w-12 text-right">{(modelOpacity * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 text-xs text-gray-300 flex items-center justify-between flex-shrink-0">
          <div className="flex flex-col">
            <span>프레임 {currentFrame + 1} / {totalFrames}</span>
            {isPlaying && (
              <span className="text-green-400 font-semibold">FPS 동기화 재생 중 ({fps} FPS)</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onPrevFrame}
              disabled={currentFrame <= 1 || isProcessing || isPlaying}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
            <button
              onClick={onNextFrame}
              disabled={currentFrame >= totalFrames || isProcessing || isPlaying}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {/* 오른쪽: 블렌드쉐이프 값 표시 */}
      <div className="flex-[1] bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-1 flex flex-col min-h-0">
        <h3 className="text-xs font-semibold text-gray-200 mb-1 flex-shrink-0">블렌드쉐이프 Weight</h3>
        <div className="flex-1 min-h-0 overflow-hidden">
          {currentBlendshapes && blendshapeNames ? (
            <BlendshapeVisualizer
              blendshapeData={currentBlendshapes}
              blendshapeNames={blendshapeNames}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-[10px]">
              데이터 없음
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
