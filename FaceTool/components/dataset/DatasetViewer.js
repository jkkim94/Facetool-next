'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ModelViewer from '@/components/common/ModelViewer';
import BlendshapeVisualizer from '@/components/common/BlendshapeVisualizer';
import { estimateTimelineMeta, getTimeAtFrame } from '@/lib/csvTimeline';

// 기본 basePath (프로젝트 루트 - 하위 디렉토리 자동 감지)
const DEFAULT_BASE_PATH = 'E:\\DatasetGen';

/**
 * 데이터셋 검증용 뷰어 (이미지 시퀀스 기반)
 * - 미리 추출된 프레임 이미지 사용
 * - 프레임 인덱스 기반 완벽한 동기화
 * - 30fps 재생 가능
 * - basePath 지원으로 다양한 데이터셋 경로 지원
 * - NPY 데이터 직접 처리
 */
export default function DatasetViewer({
  fileName,
  blendshapeData,
  fps = 30,
  glbPath = '/models/face.glb',
  split = '',
  basePath = DEFAULT_BASE_PATH,
  fileInfo = null,
}) {
  const [currentFrame, setCurrentFrame] = useState(0);
  
  // 이미지 프리로드 상태
  const [preloadedImages, setPreloadedImages] = useState([]);
  const [isPreloading, setIsPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [frameLoadError, setFrameLoadError] = useState(null);
  
  // 재생 상태
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const playbackIntervalRef = useRef(null);
  
  // 오디오 상태
  const audioRef = useRef(null);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioOffset, setAudioOffset] = useState(0); // 오디오 오프셋 (초 단위, 음수면 오디오가 늦게 시작)
  const [audioDuration, setAudioDuration] = useState(0);
  
  // 싱크 상태
  const [syncStatus, setSyncStatus] = useState({
    framesAvailable: false,
    frameCount: 0,
    blendshapeFrames: 0,
    audioSeconds: 0,
    isSynced: true,
    warnings: [],
  });
  
  // UI 상태
  const [modelOpacity, setModelOpacity] = useState(1.0);
  const [showModel, setShowModel] = useState(true);
  const [showBlendshapes, setShowBlendshapes] = useState(true);
  const [showSyncPanel, setShowSyncPanel] = useState(true);
  const [showModelTransform, setShowModelTransform] = useState(false); // 모델 위치/크기 패널 (기본 숨김)
  const [useLandmarkFrames, setUseLandmarkFrames] = useState(false); // 랜드마크 프레임 사용 여부
  const [transcriptText, setTranscriptText] = useState(null); // 현재 클립 한글 발화 텍스트(자막)

  // fileInfo 변경 시 랜드마크 토글 자동 설정
  useEffect(() => {
    if (fileInfo?.useLandmarks !== undefined) {
      setUseLandmarkFrames(fileInfo.useLandmarks && fileInfo.hasLandmarks);
    }
  }, [fileInfo]);

  // 3D 모델 변환 상태 (VideoOverlayView와 동일한 구조)
  const DEFAULT_TRANSFORM = { x: -0.15, y: 0.0, z: 4.49, scale: 1.0, rx: 0.02, ry: 0.2, rz: 0.0 };
  const [modelTransform, setModelTransform] = useState(() => {
    try {
      const saved = localStorage.getItem('datasetViewer_transform_v1');
      return saved ? JSON.parse(saved) : DEFAULT_TRANSFORM;
    } catch { return DEFAULT_TRANSFORM; }
  });

  // Transform 변경 시 localStorage에 자동 저장
  useEffect(() => {
    try { localStorage.setItem('datasetViewer_transform_v1', JSON.stringify(modelTransform)); } catch {}
  }, [modelTransform]);
  
  const [detectedFrameCount, setDetectedFrameCount] = useState(0);
  const totalFrames = blendshapeData?.totalFrames || detectedFrameCount;
  const baseName = fileName?.replace(/\.(csv|npy)$/, '') || '';

  /** CSV time_sec / WAV 길이 기반 실제 FPS (60fps 데이터셋 등) */
  const effectiveFps = useMemo(() => {
    if (blendshapeData?.detectedFps && blendshapeData.detectedFps > 0) {
      return blendshapeData.detectedFps;
    }
    if (blendshapeData?.timeSec?.length >= 2) {
      return estimateTimelineMeta(blendshapeData.timeSec).detectedFps;
    }
    if (audioDuration > 0 && totalFrames > 0) {
      return totalFrames / audioDuration;
    }
    return fps;
  }, [blendshapeData, audioDuration, totalFrames, fps]);

  const getFrameTimeSec = useCallback((frameIndex) => {
    return getTimeAtFrame(blendshapeData?.timeSec, frameIndex, effectiveFps);
  }, [blendshapeData?.timeSec, effectiveFps]);

  // 클립 변경 시 해당 클립의 한글 발화 텍스트(자막) 로드 (split 없어도 API에서 train/val/test 순으로 탐색)
  useEffect(() => {
    if (!baseName) {
      setTranscriptText(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ basePath, clip: baseName });
    if (split) params.set('split', split);
    fetch(`/api/transcript?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.ok) setTranscriptText(data.text || null);
        else if (!cancelled) setTranscriptText(null);
      })
      .catch(() => { if (!cancelled) setTranscriptText(null); });
    return () => { cancelled = true; };
  }, [baseName, split, basePath]);
  
  // API URL 생성 헬퍼
  const buildApiUrl = useCallback((endpoint, params = {}) => {
    const urlParams = new URLSearchParams();
    urlParams.set('basePath', basePath);
    if (split) urlParams.set('split', split);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlParams.set(key, value);
      }
    });
    return `/api/${endpoint}?${urlParams.toString()}`;
  }, [basePath, split]);
  
  // 프레임 폴더 정보 확인
  const checkFrameFolder = useCallback(async () => {
    if (!baseName) return;
    
    try {
      const res = await fetch('/api/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath, split, name: baseName, useLandmarks: useLandmarkFrames }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(prev => ({
          ...prev,
          framesAvailable: data.exists,
          frameCount: data.frameCount || 0,
        }));
        return data;
      }
    } catch (err) {
      console.error('[DatasetViewer] Frame folder check error:', err);
    }
    return null;
  }, [baseName, basePath, split, useLandmarkFrames]);
  
  // 모든 프레임 이미지 프리로드
  const preloadAllFrames = useCallback(async () => {
    if (!baseName) return;
    
    // 먼저 프레임 폴더 확인
    const frameInfo = await checkFrameFolder();
    if (!frameInfo?.exists) {
      console.log('[Preload] 프레임 폴더가 없습니다. 프리로드 스킵.');
      setFrameLoadError('프레임 폴더를 찾을 수 없습니다');
      setIsPreloading(false);
      return;
    }

    // blendshapeData 없을 때 프레임 폴더의 프레임 수 사용
    if (!blendshapeData && frameInfo.frameCount > 0) {
      setDetectedFrameCount(frameInfo.frameCount);
    }
    const framesToLoad = blendshapeData?.totalFrames || frameInfo.frameCount || 0;
    if (framesToLoad === 0) return;
    
    setIsPreloading(true);
    setPreloadProgress(0);
    setPreloadedImages([]);
    setFrameLoadError(null);
    
    const images = [];
    const batchSize = 20; // 동시 로드 수
    
    for (let i = 0; i < framesToLoad; i += batchSize) {
      const batch = [];
      const endIdx = Math.min(i + batchSize, framesToLoad);
      
      for (let j = i; j < endIdx; j++) {
        const promise = new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = buildApiUrl('frames', { name: baseName, frame: j, useLandmarks: useLandmarkFrames || undefined });
        });
        batch.push(promise);
      }
      
      const results = await Promise.all(batch);
      images.push(...results);
      
      setPreloadProgress(Math.round((images.length / framesToLoad) * 100));
    }
    
    setPreloadedImages(images);
    setIsPreloading(false);
    
    const loadedCount = images.filter(Boolean).length;
    console.log(`[Preload] ${loadedCount}/${framesToLoad} frames loaded`);
    
    if (loadedCount === 0) {
      setFrameLoadError('프레임 이미지를 로드할 수 없습니다');
    }
  }, [baseName, blendshapeData, checkFrameFolder, buildApiUrl, useLandmarkFrames]);
  
  // 싱크 상태 업데이트
  useEffect(() => {
    const warnings = [];
    const blendshapeFrames = blendshapeData?.totalFrames || 0;
    const frameCount = syncStatus.frameCount;
    const audioSeconds = audioDuration;
    
    // 블렌드셰이프 프레임 수와 이미지 프레임 수 비교
    if (syncStatus.framesAvailable && frameCount > 0 && blendshapeFrames > 0) {
      if (frameCount !== blendshapeFrames) {
        warnings.push(`프레임 수 불일치: PNG(${frameCount}) vs 블렌드셰이프(${blendshapeFrames})`);
      }
    }
    
    // 오디오 길이와 예상 길이 비교 (effectiveFps / time_sec 사용)
    if (audioSeconds > 0 && blendshapeFrames > 0) {
      let expectedAudioSeconds = blendshapeFrames / effectiveFps;
      if (blendshapeData?.timeSec?.length >= 2) {
        const meta = estimateTimelineMeta(blendshapeData.timeSec);
        const dt = 1 / (meta.detectedFps || effectiveFps);
        expectedAudioSeconds = blendshapeData.timeSec[blendshapeData.timeSec.length - 1] + dt;
      }
      const diff = Math.abs(audioSeconds - expectedAudioSeconds);
      if (diff > 0.5) {
        warnings.push(`오디오 길이 불일치: WAV(${audioSeconds.toFixed(2)}s) vs 예상(${expectedAudioSeconds.toFixed(2)}s, ${effectiveFps.toFixed(1)}fps)`);
      }
    }
    
    setSyncStatus(prev => ({
      ...prev,
      blendshapeFrames,
      audioSeconds,
      warnings,
      isSynced: warnings.length === 0,
    }));
  }, [blendshapeData, syncStatus.frameCount, syncStatus.framesAvailable, audioDuration, effectiveFps]);
  
  // 파일 변경 시 프리로드
  useEffect(() => {
    if (baseName && totalFrames > 0) {
      setCurrentFrame(0);
      setIsPlaying(false);
      setAudioLoaded(false);
      setFrameLoadError(null);
      preloadAllFrames();
    }
  }, [baseName, totalFrames, basePath, split, useLandmarkFrames]);
  
  // 현재 프레임의 블렌드셰이프 데이터
  const getCurrentBlendshapeData = useCallback(() => {
    if (!blendshapeData || !blendshapeData.frames) return null;
    return blendshapeData.frames[currentFrame] || null;
  }, [blendshapeData, currentFrame]);
  
  // 프레임 변경 핸들러
  const handleFrameChange = (newFrame) => {
    const clampedFrame = Math.max(0, Math.min(totalFrames - 1, newFrame));
    setCurrentFrame(clampedFrame);
  };
  
  // 재생 로직: requestAnimationFrame 기반 (setInterval 대비 끊김 감소)
  const playStartTimeRef = useRef(0);
  const playStartFrameRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || totalFrames === 0) {
      if (playbackIntervalRef.current) {
        cancelAnimationFrame(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      return;
    }

    if (audioRef.current && audioLoaded) {
      const audioTime = Math.max(0, getFrameTimeSec(currentFrame) + audioOffset);
      audioRef.current.currentTime = audioTime;
      audioRef.current.playbackRate = playbackSpeed;
      audioRef.current.play().catch(e => console.log('Audio play failed:', e));
    }
    playStartTimeRef.current = performance.now();
    playStartFrameRef.current = currentFrame;

    const frameIntervalMs = (1000 / effectiveFps) / playbackSpeed;

    const tick = (timestamp) => {
      const elapsed = timestamp - playStartTimeRef.current;
      const targetFrame = playStartFrameRef.current + Math.floor(elapsed / frameIntervalMs);
      const nextFrame = Math.min(targetFrame, totalFrames - 1);
      setCurrentFrame(nextFrame);
      if (nextFrame >= totalFrames - 1) {
        setIsPlaying(false);
        if (audioRef.current) audioRef.current.pause();
        return;
      }
      playbackIntervalRef.current = requestAnimationFrame(tick);
    };
    playbackIntervalRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackIntervalRef.current) {
        cancelAnimationFrame(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isPlaying, totalFrames, effectiveFps, playbackSpeed, audioLoaded, getFrameTimeSec, currentFrame]);
  
  // 재생/일시정지 토글 (프레임 이미지 없어도 NPY 기반 3D 재생 가능)
  const togglePlayback = useCallback(() => {
    if (totalFrames === 0) return;
    
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentFrame >= totalFrames - 1) {
        setCurrentFrame(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, currentFrame, preloadedImages.length, totalFrames]);
  
  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        setIsPlaying(false);
        handleFrameChange(currentFrame - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        e.preventDefault();
        setIsPlaying(false);
        handleFrameChange(currentFrame + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setIsPlaying(false);
        handleFrameChange(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setIsPlaying(false);
        handleFrameChange(totalFrames - 1);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrame, totalFrames, togglePlayback]);
  
  // 현재 프레임 이미지
  const currentImage = preloadedImages[currentFrame];
  
  // 오디오 URL (basePath 포함, WAV가 있을 때만)
  const hasWav = fileInfo?.hasWav !== false;
  const audioUrl = (baseName && hasWav) ? buildApiUrl('file', { name: baseName, type: 'wav' }) : '';
  
  return (
    <>
      {/* 숨겨진 오디오 엘리먼트 (key로 파일 변경 시 새로 로드) */}
      {audioUrl && (
        <audio
          key={`audio-${baseName}-${basePath}`}
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onCanPlayThrough={() => {
            console.log('[Audio] Loaded:', audioUrl);
            setAudioLoaded(true);
          }}
          onLoadedMetadata={(e) => {
            setAudioDuration(e.target.duration || 0);
          }}
          onError={(e) => {
            console.error('[Audio] Error:', audioUrl, e);
            setAudioLoaded(false);
            setAudioDuration(0);
          }}
          style={{ display: 'none' }}
        />
      )}
    <div className="flex-1 min-h-0 flex gap-2" tabIndex={0}>
      {/* 메인 뷰어 */}
      <div className="flex-[19] bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-2 flex flex-col min-h-0">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-200">
            데이터셋 검증 뷰어
          </h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showModel}
                onChange={(e) => setShowModel(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>3D Model</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <span>Opacity:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={modelOpacity * 100}
                onChange={(e) => setModelOpacity(e.target.value / 100)}
                className="w-20 h-2 accent-blue-600"
              />
              <span className="w-8">{Math.round(modelOpacity * 100)}%</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showBlendshapes}
                onChange={(e) => setShowBlendshapes(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>Weights</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showSyncPanel}
                onChange={(e) => setShowSyncPanel(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>Sync</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showModelTransform}
                onChange={(e) => setShowModelTransform(e.target.checked)}
                className="w-4 h-4 accent-purple-600"
              />
              <span>Transform</span>
            </label>
            {fileInfo?.hasLandmarks && (
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={useLandmarkFrames}
                  onChange={(e) => setUseLandmarkFrames(e.target.checked)}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className={useLandmarkFrames ? 'text-orange-400 font-semibold' : ''}>Landmark</span>
              </label>
            )}
          </div>
        </div>
        
        {/* 비디오 프레임 + 3D 모델 오버레이 (단일 화면, ComfyUI 비교 탭과 동일 방식) */}
        <div className="flex-1 min-h-0 relative bg-black">
          {/* 프리로드 진행 상태 */}
          {isPreloading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-40">
              <div className="text-white text-lg mb-4">프레임 로딩 중...</div>
              <div className="w-64 h-4 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-100"
                  style={{ width: `${preloadProgress}%` }}
                />
              </div>
              <div className="text-gray-300 text-sm mt-2">{preloadProgress}%</div>
            </div>
          )}
          
          {/* 프레임 이미지 */}
          {!isPreloading && currentImage ? (
            <img
              src={currentImage.src}
              alt={`Frame ${currentFrame}`}
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : !isPreloading && preloadedImages.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              파일을 선택해주세요
            </div>
          )}
          
          {/* 3D 모델 오버레이 - 단일 화면 위 겹침 (ComfyUI 비교 탭과 동일) */}
          {showModel && glbPath && !isPreloading && (
            <div
              className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
              style={{ opacity: modelOpacity }}
            >
              <div className="w-full h-full pointer-events-auto">
                <ModelViewer
                  key={`dataset-viewer-${glbPath}`}
                  viewerId="dataset-viewer"
                  glbPath={glbPath}
                  cameraType="perspective"
                  currentFrame={currentFrame}
                  totalFrames={totalFrames}
                  blendshapeData={getCurrentBlendshapeData()}
                  blendshapeNames={blendshapeData?.blendshapeNames || []}
                  position={[modelTransform.x, modelTransform.y, modelTransform.z]}
                  scale={modelTransform.scale}
                  rotation={[modelTransform.rx, modelTransform.ry, modelTransform.rz]}
                />
              </div>
            </div>
          )}
          
          {/* 프레임 정보 오버레이 */}
          <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs font-mono z-30">
            {isPlaying && <span className="text-green-400 mr-2">PLAY</span>}
            {useLandmarkFrames && <span className="text-orange-400 mr-2">LM</span>}
            Frame: {currentFrame} / {totalFrames - 1}
            <span className="ml-2 text-gray-400">({playbackSpeed}x, {effectiveFps.toFixed(1)}fps)</span>
            {preloadedImages.length > 0 && (
              <span className="ml-2 text-blue-400">[{preloadedImages.filter(Boolean).length} cached]</span>
            )}
            {audioLoaded && (
              <span className="ml-2 text-purple-400">[Audio OK]</span>
            )}
            {/* 싱크 상태 표시 */}
            {syncStatus.warnings.length > 0 && (
              <span className="ml-2 text-yellow-400">[SYNC WARNING]</span>
            )}
          </div>
          
          {/* 파일명 오버레이 */}
          {fileName && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-green-400 px-2 py-1 rounded text-xs z-30 max-w-xs truncate">
              {fileName}
            </div>
          )}
          
          {/* 싱크 상태 패널 */}
          {showSyncPanel && (
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-80 text-white px-3 py-2 rounded text-xs z-30 max-w-md">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold">Sync Status:</span>
                {syncStatus.isSynced ? (
                  <span className="text-green-400">OK</span>
                ) : (
                  <span className="text-yellow-400">Warning</span>
                )}
                <button
                  onClick={() => setShowSyncPanel(false)}
                  className="ml-auto text-gray-400 hover:text-white"
                >
                  x
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-gray-400">PNG:</span>{' '}
                  {syncStatus.framesAvailable ? (
                    <span className="text-green-400">{syncStatus.frameCount}</span>
                  ) : (
                    <span className="text-red-400">N/A</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-400">BS:</span>{' '}
                  <span className="text-blue-400">{syncStatus.blendshapeFrames}</span>
                </div>
                <div>
                  <span className="text-gray-400">WAV:</span>{' '}
                  {audioDuration > 0 ? (
                    <span className="text-purple-400">{audioDuration.toFixed(2)}s</span>
                  ) : (
                    <span className="text-red-400">N/A</span>
                  )}
                </div>
              </div>
              {syncStatus.warnings.length > 0 && (
                <div className="mt-1 text-[9px] text-yellow-400">
                  {syncStatus.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* 모델 위치/크기 조절 패널 (VideoOverlayView 스타일) */}
          {showModelTransform && (
            <div className="absolute top-12 right-2 bg-gray-900/95 text-white px-3 py-2 rounded-lg text-xs z-30 w-60 border border-white/10 shadow-xl">
              {/* 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">Model Transform</span>
                <button
                  onClick={() => setShowModelTransform(false)}
                  className="text-gray-400 hover:text-white"
                >
                  x
                </button>
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
                    <input type="number" step="0.01" value={modelTransform[key]}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setModelTransform(prev => ({ ...prev, [key]: v })); }}
                      className={`w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded ${color} focus:border-blue-400 outline-none`} />
                  </div>
                  <input type="range" min={min} max={max} step="0.01" value={modelTransform[key]}
                    onChange={(e) => setModelTransform(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                </div>
              ))}

              {/* Scale */}
              <div className="mb-1">
                <div className="flex justify-between items-center gap-1">
                  <span className="text-gray-400">Scale</span>
                  <input type="number" step="0.01" min="0.01" value={modelTransform.scale}
                    onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setModelTransform(prev => ({ ...prev, scale: v })); }}
                    className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-purple-400 focus:border-blue-400 outline-none" />
                </div>
                <input type="range" min="0.1" max="5" step="0.01" value={modelTransform.scale}
                  onChange={(e) => setModelTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
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
                    <input type="number" step="0.01" value={modelTransform[key]}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setModelTransform(prev => ({ ...prev, [key]: v })); }}
                      className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-orange-400 focus:border-blue-400 outline-none" />
                  </div>
                  <input type="range" min="-3.14" max="3.14" step="0.01" value={modelTransform[key]}
                    onChange={(e) => setModelTransform(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer" />
                </div>
              ))}

              {/* 액션 */}
              <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                <button
                  onClick={() => setModelTransform(DEFAULT_TRANSFORM)}
                  className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
                >
                  기본값 복원
                </button>
                <button
                  onClick={() => {
                    try {
                      localStorage.setItem('datasetViewer_transform_v1', JSON.stringify(modelTransform));
                      alert('Transform 저장 완료');
                    } catch { alert('저장 실패'); }
                  }}
                  className="w-full px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white"
                >
                  저장
                </button>
                <button
                  onClick={() => {
                    const values = `Position: [${modelTransform.x.toFixed(2)}, ${modelTransform.y.toFixed(2)}, ${modelTransform.z.toFixed(2)}], Scale: ${modelTransform.scale.toFixed(2)}, Rotation: [${modelTransform.rx.toFixed(2)}, ${modelTransform.ry.toFixed(2)}, ${modelTransform.rz.toFixed(2)}]`;
                    navigator.clipboard.writeText(values);
                    alert('Copied: ' + values);
                  }}
                  className="w-full px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white"
                >
                  값 복사
                </button>
              </div>
            </div>
          )}
          
          {/* 프레임 로드 에러 표시 */}
          {frameLoadError && !isPreloading && (
            <div className="absolute bottom-2 right-2 bg-red-900 bg-opacity-80 text-white px-3 py-2 rounded text-xs z-30">
              {frameLoadError}
            </div>
          )}

          {/* 자막: 비디오 하단 고정, 현재 클립 한글 발화 텍스트 */}
          {transcriptText != null && transcriptText !== '' && (
            <div className="absolute bottom-0 left-0 right-0 z-20 px-4 py-3 bg-black/85 flex items-center justify-center text-center">
              <p className="text-base text-white leading-relaxed max-w-full" style={{ wordBreak: 'keep-all', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                {transcriptText}
              </p>
            </div>
          )}
        </div>
        
        {/* 프레임 네비게이션 */}
        <div className="flex items-center justify-center gap-2 mt-2 flex-shrink-0">
          <button
            onClick={togglePlayback}
            disabled={preloadedImages.length === 0 || isPreloading}
            className={`px-4 py-1 rounded text-xs font-semibold disabled:opacity-50 ${
              isPlaying
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isPlaying ? 'Stop' : 'Play'}
          </button>
          
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            className="px-1 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200"
          >
            <option value="0.1">0.1x</option>
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1.0">1.0x</option>
            <option value="2.0">2.0x</option>
          </select>
          
          <span className="text-gray-500">|</span>
          
          {/* 오디오 오프셋 조절 */}
          <label className="flex items-center gap-1 text-xs text-gray-300">
            <span>Audio:</span>
            <input
              type="number"
              value={audioOffset}
              onChange={(e) => setAudioOffset(parseFloat(e.target.value) || 0)}
              step="0.01"
              className="w-16 px-1 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white"
            />
            <span>s</span>
            <button
              onClick={() => setAudioOffset(prev => prev - 0.05)}
              className="px-1 py-0.5 bg-gray-600 hover:bg-gray-500 rounded text-xs"
            >-</button>
            <button
              onClick={() => setAudioOffset(prev => prev + 0.05)}
              className="px-1 py-0.5 bg-gray-600 hover:bg-gray-500 rounded text-xs"
            >+</button>
          </label>
          
          <span className="text-gray-500">|</span>
          
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(0); }}
            disabled={currentFrame === 0}
            className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600 text-gray-200"
          >
            |◀
          </button>
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(currentFrame - 10); }}
            disabled={currentFrame === 0}
            className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600 text-gray-200"
          >
            ◀◀
          </button>
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(currentFrame - 1); }}
            disabled={currentFrame === 0}
            className="px-3 py-1 bg-blue-600 rounded text-xs disabled:opacity-50 hover:bg-blue-500 font-semibold text-white"
          >
            ◀ Prev
          </button>
          
          <input
            type="number"
            value={currentFrame}
            onChange={(e) => {
              setIsPlaying(false);
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) handleFrameChange(val);
            }}
            className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white font-mono"
            min={0}
            max={totalFrames - 1}
          />
          
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(currentFrame + 1); }}
            disabled={currentFrame >= totalFrames - 1}
            className="px-3 py-1 bg-blue-600 rounded text-xs disabled:opacity-50 hover:bg-blue-500 font-semibold text-white"
          >
            Next ▶
          </button>
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(currentFrame + 10); }}
            disabled={currentFrame >= totalFrames - 1}
            className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600 text-gray-200"
          >
            ▶▶
          </button>
          <button
            onClick={() => { setIsPlaying(false); handleFrameChange(totalFrames - 1); }}
            disabled={currentFrame >= totalFrames - 1}
            className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600 text-gray-200"
          >
            ▶|
          </button>
          
          {/* 슬라이더 */}
          <div className="flex-1 mx-4">
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              value={currentFrame}
              onChange={(e) => { setIsPlaying(false); handleFrameChange(parseInt(e.target.value, 10)); }}
              className="w-full h-2 accent-blue-600"
            />
          </div>
        </div>
      </div>
      
      {/* 오른쪽: 블렌드셰이프 값 표시 */}
      {showBlendshapes && (
        <div className="flex-[1] bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-1 flex flex-col min-h-0">
          <h3 className="text-xs font-semibold text-gray-200 mb-1 flex-shrink-0">Blendshape Weights</h3>
          <div className="flex-1 min-h-0 overflow-hidden">
            {getCurrentBlendshapeData() && blendshapeData?.blendshapeNames ? (
              <BlendshapeVisualizer
                blendshapeData={getCurrentBlendshapeData()}
                blendshapeNames={blendshapeData.blendshapeNames}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500 text-[10px]">
                데이터 없음
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
