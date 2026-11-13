/**
 * CSV + WAV 직접 임포트 · 동일 오디오 · 2개 아바타 비교 + 원본 비디오 프레임
 */

'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import ModelViewer from '@/components/common/ModelViewer'
import PlaybackControls from '@/components/common/PlaybackControls'
import ModelTransformPanel, { DEFAULT_MODEL_TRANSFORM } from '@/components/common/ModelTransformPanel'
import { parseLocalBlendshapeCsv } from '@/lib/parseLocalBlendshapeCsv'
import { findFrameAtTime, getTimeAtFrame } from '@/lib/csvTimeline'

const GLB_PATH = '/models/face.glb'
const TRANSFORM_STORAGE_KEY = 'csvCompare_transform_v1'
const DEFAULT_FRAMES_BASE = 'E:\\DatasetGen'

function FileImportButton({ label, accept, fileName, onFile, accent = 'blue' }) {
  const inputRef = useRef(null)
  const color =
    accent === 'emerald'
      ? 'bg-emerald-700 hover:bg-emerald-600'
      : accent === 'amber'
        ? 'bg-amber-700 hover:bg-amber-600'
        : accent === 'violet'
          ? 'bg-violet-700 hover:bg-violet-600'
          : 'bg-blue-700 hover:bg-blue-600'

  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <label className="text-[10px] text-gray-400">{label}</label>
      <div className="flex gap-1 min-w-0">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`px-3 py-1.5 rounded text-xs font-semibold text-white shrink-0 ${color}`}
        >
          파일 선택
        </button>
        <span className="text-xs text-gray-400 truncate self-center" title={fileName || ''}>
          {fileName || '미선택'}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function AvatarPanel({ label, labelClass, borderClass, fileName, frameCount, ready, emptyText, children }) {
  return (
    <div className={`min-w-0 min-h-0 relative bg-black rounded-lg overflow-hidden border ${borderClass}`}>
      <div className={`absolute top-1 left-1 z-10 text-xs font-mono text-white ${labelClass} px-2 py-1 rounded max-w-[90%] truncate`}>
        {label} {fileName ? `· ${fileName}` : ''}
        {frameCount ? ` (${frameCount}f)` : ''}
      </div>
      {ready ? (
        <div className="absolute inset-0">{children}</div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm px-2 text-center">
          {emptyText}
        </div>
      )}
    </div>
  )
}

export default function CsvCompareView() {
  const [fps, setFps] = useState(30)
  const [dataA, setDataA] = useState(null)
  const [dataB, setDataB] = useState(null)
  const [nameA, setNameA] = useState('')
  const [nameB, setNameB] = useState('')
  const [wavName, setWavName] = useState('')
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [error, setError] = useState(null)

  const [mp4Name, setMp4Name] = useState('')
  const [videoUrl, setVideoUrl] = useState(null)
  const videoRef = useRef(null)

  const [framesBasePath, setFramesBasePath] = useState(DEFAULT_FRAMES_BASE)
  const [framesBasePathInput, setFramesBasePathInput] = useState(DEFAULT_FRAMES_BASE)
  const [framesSplit, setFramesSplit] = useState('')
  const [clipStem, setClipStem] = useState('')
  const [preloadedImages, setPreloadedImages] = useState([])
  const [isPreloading, setIsPreloading] = useState(false)
  const [preloadProgress, setPreloadProgress] = useState(0)
  const [frameLoadError, setFrameLoadError] = useState(null)

  const [currentFrame, setCurrentFrame] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const [showModelTransform, setShowModelTransform] = useState(false)

  const audioRef = useRef(null)
  const playbackRAFRef = useRef(null)
  const playStartTimeRef = useRef(0)
  const playStartTimeSecRef = useRef(0)
  const lastFrameRef = useRef(-1)
  const totalFramesRef = useRef(1)

  const [modelTransform, setModelTransform] = useState(() => {
    try {
      const saved = localStorage.getItem(TRANSFORM_STORAGE_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_MODEL_TRANSFORM
    } catch {
      return DEFAULT_MODEL_TRANSFORM
    }
  })

  useEffect(() => {
    useGLTF.preload(GLB_PATH)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(TRANSFORM_STORAGE_KEY, JSON.stringify(modelTransform))
    } catch {}
  }, [modelTransform])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  const buildFramesUrl = useCallback(
    (frameIndex) => {
      const params = new URLSearchParams()
      params.set('basePath', framesBasePath)
      if (framesSplit) params.set('split', framesSplit)
      params.set('name', clipStem)
      params.set('frame', String(frameIndex))
      return `/api/frames?${params.toString()}`
    },
    [framesBasePath, framesSplit, clipStem]
  )

  const preloadDatasetFrames = useCallback(async () => {
    if (!clipStem.trim()) {
      setFrameLoadError('클립 이름( stem )을 입력하세요')
      return
    }
    const framesToLoad = totalFramesRef.current || 1
    setIsPreloading(true)
    setPreloadProgress(0)
    setPreloadedImages([])
    setFrameLoadError(null)

    try {
      const checkRes = await fetch('/api/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: framesBasePath, split: framesSplit, name: clipStem }),
      })
      const checkData = await checkRes.json()
      if (!checkData.exists) {
        setFrameLoadError('데이터셋 프레임 폴더를 찾을 수 없습니다')
        setIsPreloading(false)
        return
      }

      const count = Math.min(framesToLoad, checkData.frameCount || framesToLoad)
      const images = []
      const batchSize = 20
      for (let i = 0; i < count; i += batchSize) {
        const endIdx = Math.min(i + batchSize, count)
        const batch = []
        for (let j = i; j < endIdx; j++) {
          batch.push(
            new Promise((resolve) => {
              const img = new Image()
              img.onload = () => resolve(img)
              img.onerror = () => resolve(null)
              img.src = buildFramesUrl(j)
            })
          )
        }
        const results = await Promise.all(batch)
        images.push(...results)
        setPreloadProgress(Math.round((images.length / count) * 100))
      }
      setPreloadedImages(images)
      if (images.filter(Boolean).length === 0) {
        setFrameLoadError('프레임 이미지를 로드할 수 없습니다')
      }
    } catch (err) {
      setFrameLoadError(err.message || '프레임 로드 실패')
    } finally {
      setIsPreloading(false)
    }
  }, [clipStem, framesBasePath, framesSplit, buildFramesUrl])

  const loadCsv = useCallback(async (file, slot) => {
    setError(null)
    try {
      const text = await file.text()
      const parsed = parseLocalBlendshapeCsv(text)
      if (slot === 'A') {
        setDataA(parsed)
        setNameA(file.name)
      } else {
        setDataB(parsed)
        setNameB(file.name)
      }
      if (parsed.hasTimeSec && parsed.detectedFps > 0) {
        const rounded = Math.round(parsed.detectedFps)
        setFps(rounded >= 1 && rounded <= 120 ? rounded : 30)
      }
      setCurrentFrame(0)
      setIsPlaying(false)
    } catch (err) {
      setError(`${file.name}: ${err.message}`)
    }
  }, [])

  const loadWav = useCallback(
    (file) => {
      setError(null)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      const url = URL.createObjectURL(file)
      setAudioUrl(url)
      setWavName(file.name)
      const stem = file.name.replace(/\.wav$/i, '')
      setClipStem(stem)
      setCurrentFrame(0)
      setIsPlaying(false)
    },
    [audioUrl]
  )

  const loadMp4 = useCallback(
    (file) => {
      setError(null)
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      const url = URL.createObjectURL(file)
      setVideoUrl(url)
      setMp4Name(file.name)
      const stem = file.name.replace(/\.(mp4|MP4)$/i, '')
      if (!clipStem) setClipStem(stem)
      setPreloadedImages([])
      setFrameLoadError(null)
    },
    [videoUrl, clipStem]
  )

  const primaryTimeline = useMemo(() => dataA ?? dataB, [dataA, dataB])

  const timelineDuration = useMemo(() => {
    return Math.max(
      audioDuration,
      dataA?.duration ?? 0,
      dataB?.duration ?? 0,
      primaryTimeline?.duration ?? 0,
      0.001
    )
  }, [audioDuration, dataA, dataB, primaryTimeline])

  const totalFrames = useMemo(() => {
    const fromCsv = primaryTimeline?.totalFrames || 0
    const fromImages = preloadedImages.length || 0
    return Math.max(fromCsv, fromImages, 1)
  }, [primaryTimeline, preloadedImages.length])

  totalFramesRef.current = totalFrames

  const currentTimeSec = useMemo(
    () => getTimeAtFrame(primaryTimeline?.timeSec, currentFrame, fps),
    [primaryTimeline, currentFrame, fps]
  )

  const frameA = useMemo(() => {
    if (!dataA) return 0
    if (dataA.timeSec?.length) return findFrameAtTime(dataA.timeSec, currentTimeSec)
    return Math.min(currentFrame, Math.max(0, dataA.totalFrames - 1))
  }, [dataA, currentFrame, currentTimeSec])

  const frameB = useMemo(() => {
    if (!dataB) return 0
    if (dataB.timeSec?.length) return findFrameAtTime(dataB.timeSec, currentTimeSec)
    return Math.min(currentFrame, Math.max(0, dataB.totalFrames - 1))
  }, [dataB, currentFrame, currentTimeSec])

  const blendA = dataA?.frames?.[frameA] ?? null
  const blendB = dataB?.frames?.[frameB] ?? null
  const readyA = Boolean(blendA && dataA?.blendshapeNames?.length > 0)
  const readyB = Boolean(blendB && dataB?.blendshapeNames?.length > 0)
  const canPlay = totalFrames > 0 && (dataA || dataB)

  const currentFrameImage = preloadedImages[currentFrame] || null

  const resolveFrameFromTime = useCallback(
    (timeSec) => {
      if (primaryTimeline?.timeSec?.length) {
        return findFrameAtTime(primaryTimeline.timeSec, timeSec)
      }
      return Math.max(0, Math.min(Math.floor(timeSec * fps), totalFrames - 1))
    },
    [primaryTimeline, fps, totalFrames]
  )

  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl || currentFrameImage) return
    const t = currentTimeSec
    if (Math.abs(v.currentTime - t) > 0.04) {
      try {
        v.currentTime = t
      } catch {}
    }
  }, [currentTimeSec, videoUrl, currentFrameImage])

  const handlePlay = useCallback(() => {
    if (!canPlay) return
    const t0 = currentTimeSec
    playStartTimeRef.current = Date.now()
    playStartTimeSecRef.current = t0
    lastFrameRef.current = -1
    setIsPlaying(true)
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = t0
      audioRef.current.playbackRate = playbackRate
      audioRef.current.play().catch(() => {})
    }
  }, [canPlay, currentTimeSec, playbackRate, audioUrl])

  const handleStop = useCallback(() => {
    setIsPlaying(false)
    if (audioRef.current) audioRef.current.pause()
    if (playbackRAFRef.current) {
      cancelAnimationFrame(playbackRAFRef.current)
      playbackRAFRef.current = null
    }
  }, [])

  const handleSeek = useCallback(
    (frame) => {
      setCurrentFrame(frame)
      const t = getTimeAtFrame(primaryTimeline?.timeSec, frame, fps)
      if (audioRef.current && audioUrl) {
        audioRef.current.currentTime = t
      }
    },
    [fps, audioUrl, primaryTimeline]
  )

  useEffect(() => {
    if (!isPlaying || totalFrames === 0) {
      if (playbackRAFRef.current) {
        cancelAnimationFrame(playbackRAFRef.current)
        playbackRAFRef.current = null
      }
      return
    }
    const tick = () => {
      let timeSec
      if (audioRef.current && audioUrl && !audioRef.current.paused) {
        timeSec = audioRef.current.currentTime
      } else {
        const elapsed = (Date.now() - playStartTimeRef.current) / 1000
        timeSec = playStartTimeSecRef.current + elapsed * playbackRate
      }
      if (timeSec >= timelineDuration - 1e-4) {
        handleStop()
        return
      }
      const frame = resolveFrameFromTime(timeSec)
      if (frame !== lastFrameRef.current) {
        lastFrameRef.current = frame
        setCurrentFrame(frame)
      }
      playbackRAFRef.current = requestAnimationFrame(tick)
    }
    playbackRAFRef.current = requestAnimationFrame(tick)
    return () => {
      if (playbackRAFRef.current) {
        cancelAnimationFrame(playbackRAFRef.current)
        playbackRAFRef.current = null
      }
    }
  }, [isPlaying, totalFrames, playbackRate, audioUrl, handleStop, timelineDuration, resolveFrameFromTime])

  const pos = [modelTransform.x, modelTransform.y, modelTransform.z]
  const rot = [modelTransform.rx, modelTransform.ry, modelTransform.rz]

  return (
    <div className="h-full bg-gray-900 p-2 flex flex-col gap-2">
      <div className="shrink-0 p-2 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-white">CSV 비교 (로컬 임포트)</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={showModelTransform}
              onChange={(e) => setShowModelTransform(e.target.checked)}
              className="w-4 h-4 accent-purple-600"
            />
            <span>Transform</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-300 ml-auto">
            <span>FPS</span>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value={25}>25</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
          {primaryTimeline?.hasTimeSec && (
            <span className="text-[10px] text-violet-300" title="CSV time_sec 열로 동기화">
              time_sec · ~{Math.round(primaryTimeline.detectedFps)}fps
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <FileImportButton
            label="공통 오디오 (WAV)"
            accept=".wav,audio/wav,audio/*"
            fileName={wavName}
            onFile={loadWav}
            accent="blue"
          />
          <FileImportButton
            label="원본 비디오 (MP4)"
            accept=".mp4,video/mp4,video/*"
            fileName={mp4Name}
            onFile={loadMp4}
            accent="violet"
          />
          <FileImportButton
            label="CSV A"
            accept=".csv,text/csv"
            fileName={nameA}
            onFile={(f) => loadCsv(f, 'A')}
            accent="emerald"
          />
          <FileImportButton
            label="CSV B"
            accept=".csv,text/csv"
            fileName={nameB}
            onFile={(f) => loadCsv(f, 'B')}
            accent="amber"
          />
        </div>
        <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-gray-700">
          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <label className="text-[10px] text-gray-400">데이터셋 프레임 경로 (PNG 시퀀스)</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={framesBasePathInput}
                onChange={(e) => setFramesBasePathInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setFramesBasePath(framesBasePathInput.trim())}
                className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono"
                placeholder="E:\DatasetGen"
              />
              <button
                type="button"
                onClick={() => setFramesBasePath(framesBasePathInput.trim())}
                className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-white"
              >
                적용
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-gray-400">split</label>
            <select
              value={framesSplit}
              onChange={(e) => setFramesSplit(e.target.value)}
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
            >
              <option value="">(자동)</option>
              <option value="train">train</option>
              <option value="val">val</option>
              <option value="test">test</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[160px] flex-1">
            <label className="text-[10px] text-gray-400">클립 stem (WAV 파일명과 동일)</label>
            <input
              type="text"
              value={clipStem}
              onChange={(e) => setClipStem(e.target.value)}
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono"
              placeholder="lip_J_1_M_01_E237_A_001"
            />
          </div>
          <button
            type="button"
            onClick={preloadDatasetFrames}
            disabled={isPreloading || !clipStem.trim()}
            className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:bg-gray-600 rounded text-xs font-semibold text-white"
          >
            {isPreloading ? `로딩 ${preloadProgress}%` : '데이터셋 프레임 로드'}
          </button>
        </div>
        <p className="text-[10px] text-gray-500">
          MP4를 직접 넣거나, 데이터셋 검증과 같이 basePath + 클립 stem으로 PNG 프레임을 불러올 수 있습니다.
        </p>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 grid grid-cols-3 gap-2 min-w-0">
          <div className="min-w-0 min-h-0 relative bg-black rounded-lg overflow-hidden border border-gray-700">
            <div className="absolute top-1 left-1 z-10 text-xs font-mono text-white bg-gray-800/90 px-2 py-1 rounded">
              2D Video
              {isPreloading && ` · ${preloadProgress}%`}
            </div>
            {isPreloading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-sm">
                <div className="w-48 h-2 bg-gray-700 rounded overflow-hidden mb-2">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${preloadProgress}%` }}
                  />
                </div>
                프레임 로딩 중...
              </div>
            ) : currentFrameImage ? (
              <img
                src={currentFrameImage.src}
                alt={`Frame ${currentFrame}`}
                className="absolute inset-0 w-full h-full object-contain"
                draggable={false}
              />
            ) : videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="absolute inset-0 w-full h-full object-contain"
                muted
                playsInline
                preload="auto"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm text-center px-2">
                MP4 또는 데이터셋 프레임을 로드하세요
              </div>
            )}
            {frameLoadError && !isPreloading && (
              <div className="absolute bottom-1 left-1 right-1 z-10 text-[10px] text-red-300 bg-red-900/80 px-2 py-1 rounded">
                {frameLoadError}
              </div>
            )}
          </div>

          <AvatarPanel
            label="A"
            labelClass="bg-emerald-900/80"
            borderClass="border-emerald-900/50"
            fileName={nameA}
            frameCount={dataA?.totalFrames}
            ready={readyA}
            emptyText="CSV A를 임포트하세요"
          >
            {readyA && dataA ? (
              <ModelViewer
                viewerId="csv-compare-a"
                glbPath={GLB_PATH}
                cameraType="perspective"
                currentFrame={frameA}
                totalFrames={dataA.totalFrames}
                blendshapeData={blendA}
                blendshapeNames={dataA.blendshapeNames}
                position={pos}
                scale={modelTransform.scale}
                rotation={rot}
              />
            ) : null}
          </AvatarPanel>

          <AvatarPanel
            label="B"
            labelClass="bg-amber-900/80"
            borderClass="border-amber-900/50"
            fileName={nameB}
            frameCount={dataB?.totalFrames}
            ready={readyB}
            emptyText="CSV B를 임포트하세요"
          >
            {readyB && dataB ? (
              <ModelViewer
                viewerId="csv-compare-b"
                glbPath={GLB_PATH}
                cameraType="perspective"
                currentFrame={frameB}
                totalFrames={dataB.totalFrames}
                blendshapeData={blendB}
                blendshapeNames={dataB.blendshapeNames}
                position={pos}
                scale={modelTransform.scale}
                rotation={rot}
              />
            ) : null}
          </AvatarPanel>
        </div>

        {showModelTransform && (
          <ModelTransformPanel
            transform={modelTransform}
            onChange={setModelTransform}
            storageKey={TRANSFORM_STORAGE_KEY}
            onClose={() => setShowModelTransform(false)}
            className="absolute top-2 right-2 z-40"
          />
        )}
      </div>

      <div className="shrink-0">
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            className="hidden"
            onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration || 0)}
          />
        )}
        {canPlay && (
          <PlaybackControls
            isPlaying={isPlaying}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            currentTime={currentTimeSec}
            duration={timelineDuration}
            playbackRate={playbackRate}
            onPlay={handlePlay}
            onPause={handleStop}
            onSeek={handleSeek}
            onPlaybackRateChange={setPlaybackRate}
          />
        )}
      </div>

      {error && (
        <div className="shrink-0 p-2 bg-red-900/50 border border-red-700 text-red-300 rounded text-xs">
          {error}
        </div>
      )}
    </div>
  )
}
