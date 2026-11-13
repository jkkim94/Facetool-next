/**
 * ============================================================================
 * ServiceView - Tab 3: 서비스 (학습 완료 후 추론)
 * ============================================================================
 *
 * UX 흐름:
 *   1. 학습 모델(run) 선택 → GET /api/runs
 *   2. 체크포인트 선택 → GET /api/checkpoints?run=...
 *   3. 오디오 업로드
 *   4. 화자(identity) 선택 → GET /api/speakers?run=...
 *   5. 추론 실행 → POST /api/inference
 *   6. 결과 분기:
 *      - ARKit 51 (pretrained): blendshapes_glb → GLB morph
 *      - MetaHuman 260 (D8 control260): blendshapes → RigLogic
 *
 * run 선택으로 output_kind 결정 (별도 토글 없음).
 * ============================================================================
 */

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  fetchRuns,
  fetchCheckpoints,
  fetchSpeakers,
  fetchInferenceConfig,
  postInference,
  getApiErrorMessage,
} from '@/lib/api/client'
import {
  normalizeRunEntry,
  filterServiceRuns,
  groupRunsForUi,
  detectOutputKind,
  getGlbMorphNames,
  outputKindLabel,
  isMetaHumanRun,
} from '@/lib/inference/outputKind'
import ModelViewer from '@/components/common/ModelViewer'
import BlendshapeVisualizer from '@/components/common/BlendshapeVisualizer'
import PlaybackControls from '@/components/common/PlaybackControls'
import ServiceRigLogicViewer from '@/components/service/ServiceRigLogicViewer'

export default function ServiceView() {
  // ---- 선택 상태 ----
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState('')
  const [serverBase, setServerBase] = useState('http://localhost:8765')
  const [checkpoints, setCheckpoints] = useState([])
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')
  const [speakers, setSpeakers] = useState(null)
  const [selectedSpeaker, setSelectedSpeaker] = useState(0)
  const [audioFile, setAudioFile] = useState(null)
  const [audioFileName, setAudioFileName] = useState('')

  // ---- 로딩/에러 ----
  const [runsLoading, setRunsLoading] = useState(false)
  const [checkpointsLoading, setCheckpointsLoading] = useState(false)
  const [speakersLoading, setSpeakersLoading] = useState(false)
  const [inferenceLoading, setInferenceLoading] = useState(false)
  const [localOnnxMode, setLocalOnnxMode] = useState(false)
  const [error, setError] = useState(null)

  // ---- 추론 결과 ----
  const [resultData, setResultData] = useState(null)    // { blendshapes, data, fps, frames, output_kind, channels }
  const [outputKind, setOutputKind] = useState(null)    // 'arkit_51' | 'metahuman_260'
  const [glbPath] = useState('/models/face.glb')

  useEffect(() => {
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [])

  // ---- 3D 모델 Transform (DatasetViewer와 동일: 사용자가 직접 설정 후 저장) ----
  const DEFAULT_TRANSFORM = { x: -0.15, y: 0.0, z: 4.49, scale: 1.0, rx: 0.02, ry: 0.2, rz: 0.0 }
  const [modelTransform, setModelTransform] = useState(() => {
    try {
      const saved = localStorage.getItem('serviceViewer_transform_v1')
      return saved ? JSON.parse(saved) : DEFAULT_TRANSFORM
    } catch { return DEFAULT_TRANSFORM }
  })
  const [showModelTransform, setShowModelTransform] = useState(false)
  useEffect(() => {
    try { localStorage.setItem('serviceViewer_transform_v1', JSON.stringify(modelTransform)) } catch {}
  }, [modelTransform])

  // ---- 재생 상태 ----
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)
  const playbackRAFRef = useRef(null)
  const totalFramesRef = useRef(0)
  const handleStopRef = useRef(() => {})
  const resultDataRef = useRef(null)
  const playStartTimeRef = useRef(0)
  const playStartFrameRef = useRef(0)
  const lastFrameRef = useRef(-1)
  const currentFrameRef = useRef(0)
  /** MetaHuman deform용 — RAF에서 읽음 (React state와 분리) */
  const playbackFrameRef = useRef(0)
  const isMetaHumanOutputRef = useRef(false)

  // ---- 오디오 URL ----
  const audioUrl = useMemo(() => {
    if (audioFile) {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      const url = URL.createObjectURL(audioFile)
      audioUrlRef.current = url
      return url
    }
    return null
  }, [audioFile])

  // ---- 1. Runs 목록 로드 ----
  useEffect(() => {
    const loadRuns = async () => {
      setRunsLoading(true)
      try {
        const data = await fetchRuns()
        if (data.success) {
          const raw = data.runs || []
          const normalized = raw
            .map(normalizeRunEntry)
            .filter(Boolean)
          setRuns(filterServiceRuns(normalized))
        } else {
          setError(getApiErrorMessage(data))
        }
      } catch (err) {
        setError(`서버 연결 실패: ${err.message}`)
      } finally {
        setRunsLoading(false)
      }
    }
    loadRuns()
  }, [])

  useEffect(() => {
    fetchInferenceConfig()
      .then((cfg) => setLocalOnnxMode(Boolean(cfg.localOnnx)))
      .catch(() => setLocalOnnxMode(false))
  }, [])

  // ---- 2. Run 선택 시 체크포인트 + 화자 로드 ----
  useEffect(() => {
    if (!selectedRun) {
      setCheckpoints([])
      setSpeakers(null)
      return
    }
    const loadDetails = async () => {
      setCheckpointsLoading(true)
      setSpeakersLoading(true)
      setError(null)
      try {
        const [cpData, spData] = await Promise.all([
          fetchCheckpoints(selectedRun),
          fetchSpeakers(selectedRun),
        ])

        if (cpData.success) {
          setCheckpoints(cpData.checkpoints || [])
          if (cpData.checkpoints?.length > 0) {
            const list = cpData.checkpoints
            if (selectedRun === 'pretrained') {
              const uni = list.find((c) => /UniTalker-B-D0-D7/i.test(c))
              setSelectedCheckpoint(uni || list[0])
            } else {
              const best = list.find((c) => c.includes('best'))
              setSelectedCheckpoint(best || list[0])
            }
          }
        } else {
          setError(getApiErrorMessage(cpData))
        }

        if (spData.success) {
          setSpeakers(spData.speakers)
          setSelectedSpeaker(0)
        }
      } catch (err) {
        setError(`상세 정보 로드 실패: ${err.message}`)
      } finally {
        setCheckpointsLoading(false)
        setSpeakersLoading(false)
      }
    }
    loadDetails()
  }, [selectedRun])

  // ---- 오디오 파일 선택 ----
  const handleAudioSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) {
      setAudioFile(file)
      setAudioFileName(file.name)
    }
  }, [])

  // ---- 추론 실행 ----
  const handleInference = useCallback(async () => {
    if (!audioFile) {
      setError('오디오를 선택해주세요')
      return
    }
    if (!localOnnxMode && !selectedRun) {
      setError('학습 모델과 오디오를 선택해주세요')
      return
    }

    setInferenceLoading(true)
    setError(null)
    setResultData(null)
    setOutputKind(null)
    setIsPlaying(false)
    setCurrentFrame(0)
    playbackFrameRef.current = 0
    lastFrameRef.current = -1

    try {
      // 오디오를 base64로 변환
      const arrayBuffer = await audioFile.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      const body = {
        audio: base64,
        enable_eye_blink: true,
      }
      if (!localOnnxMode) {
        body.run = selectedRun
        body.checkpoint = selectedCheckpoint || 'best.pt'
        body.speaker = selectedSpeaker
      } else {
        body.run = selectedRun || 'local_onnx'
      }
      // 화자_오디오이름 형식으로 전달 (날짜 prefix 없이, 백엔드 저장/GT 조회용). 요청 시점의 파일명 사용(상태 누락 방지)
      const nameForSource = (audioFileName && audioFileName.trim()) || (audioFile.name && audioFile.name.trim()) || ''
      if (nameForSource) {
        body.source_audio_filename = `speaker${selectedSpeaker}_${nameForSource}`
      }

      const { response: res, data } = await postInference(body)

      if (data.success) {
        setResultData(data)
        try {
          setOutputKind(detectOutputKind(data, selectedRun))
        } catch (kindErr) {
          setOutputKind(null)
          setError(kindErr.message)
        }
      } else {
        setError(
          res.status === 503
            ? '추론 서비스를 사용할 수 없습니다. 백엔드 서버 상태를 확인하세요.'
            : getApiErrorMessage(data)
        )
      }
    } catch (err) {
      setError(`추론 요청 실패: ${err?.message ?? String(err)}`)
    } finally {
      setInferenceLoading(false)
    }
  }, [selectedRun, selectedCheckpoint, selectedSpeaker, audioFile, audioFileName, localOnnxMode])

  // ---- 재생 / 정지 ----
  const handlePlay = useCallback(() => {
    if (!resultData) return
    playStartTimeRef.current = Date.now()
    playStartFrameRef.current = currentFrameRef.current
    playbackFrameRef.current = currentFrameRef.current
    lastFrameRef.current = -1
    setIsPlaying(true)
    if (audioRef.current) {
      audioRef.current.currentTime = currentFrameRef.current / (resultData.fps || 30)
      audioRef.current.playbackRate = playbackRate
      audioRef.current.play().catch(() => {})
    }
  }, [resultData, playbackRate])

  const handleStop = useCallback(() => {
    setIsPlaying(false)
    setCurrentFrame(playbackFrameRef.current)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    if (playbackRAFRef.current != null) {
      cancelAnimationFrame(playbackRAFRef.current)
      playbackRAFRef.current = null
    }
  }, [])

  handleStopRef.current = handleStop

  // resultData를 ref에 동기화 (재생 effect가 resultData 의존으로 매 렌더마다 돌지 않도록)
  useEffect(() => {
    resultDataRef.current = resultData
    if (resultData) {
      totalFramesRef.current = resultData.frames || resultData.data?.length || 0
    }
  }, [resultData])

  // currentFrame ref 동기화 (재생 시작 프레임용)
  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    isMetaHumanOutputRef.current = outputKind === 'metahuman_260'
  }, [outputKind])

  // 재생 중 UI 프레임 표시 — RAF와 분리 (Maximum update depth 방지)
  useEffect(() => {
    if (!isPlaying) return undefined
    const id = setInterval(() => {
      const fi = playbackFrameRef.current
      setCurrentFrame((prev) => (prev === fi ? prev : fi))
    }, 300)
    return () => clearInterval(id)
  }, [isPlaying])

  // ---- 프레임 기반 재생: RAF → playbackFrameRef만 갱신 ----
  useEffect(() => {
    if (!isPlaying) {
      if (playbackRAFRef.current != null) {
        cancelAnimationFrame(playbackRAFRef.current)
        playbackRAFRef.current = null
      }
      return
    }
    const data = resultDataRef.current
    if (!data) {
      return () => {
        if (playbackRAFRef.current != null) {
          cancelAnimationFrame(playbackRAFRef.current)
          playbackRAFRef.current = null
        }
      }
    }
    const totalFrames = Math.max(0, data.frames || data.data?.length || 0)
    totalFramesRef.current = totalFrames
    if (totalFrames <= 0) {
      handleStopRef.current()
      return
    }
    const rate = playbackRate

    const tick = () => {
      const dataNow = resultDataRef.current
      if (!dataNow || totalFramesRef.current === 0) {
        playbackRAFRef.current = requestAnimationFrame(tick)
        return
      }
      const fpsNow = dataNow.fps || 30
      const totalNow = totalFramesRef.current
      let frame
      if (audioRef.current && !audioRef.current.paused) {
        frame = Math.floor(audioRef.current.currentTime * fpsNow)
      } else {
        const elapsed = (Date.now() - playStartTimeRef.current) / 1000
        frame = playStartFrameRef.current + Math.floor(elapsed * fpsNow * rate)
      }
      const clamped = Math.max(0, Math.min(frame, totalNow - 1))
      playbackFrameRef.current = clamped
      if (clamped !== lastFrameRef.current) {
        lastFrameRef.current = clamped
        // ARKit GLB: ModelViewer가 currentFrame prop 사용
        if (!isMetaHumanOutputRef.current) {
          setCurrentFrame((prev) => (prev === clamped ? prev : clamped))
        }
      }
      if (clamped >= totalNow - 1) {
        playbackFrameRef.current = clamped
        lastFrameRef.current = clamped
        handleStopRef.current()
        return
      }
      playbackRAFRef.current = requestAnimationFrame(tick)
    }
    playbackRAFRef.current = requestAnimationFrame(tick)
    return () => {
      if (playbackRAFRef.current != null) {
        cancelAnimationFrame(playbackRAFRef.current)
        playbackRAFRef.current = null
      }
    }
  }, [isPlaying, playbackRate])

  // ---- 현재 프레임의 블렌드쉐입 데이터 ----
  const currentBlendshapeData = useMemo(() => {
    if (!resultData?.data || !resultData?.blendshapes) return null
    const frameData = resultData.data[currentFrame]
    if (!frameData) return null

    const result = {}
    resultData.blendshapes.forEach((name, i) => {
      result[name] = Array.isArray(frameData) ? frameData[i] : (frameData[name] || 0)
    })
    return result
  }, [resultData, currentFrame])

  const runGroups = useMemo(() => groupRunsForUi(runs), [runs])
  const selectedRunEntry = useMemo(
    () => runs.find((r) => r.id === selectedRun) ?? null,
    [runs, selectedRun],
  )
  const expectedOutputKind = useMemo(() => {
    if (isMetaHumanRun(selectedRunEntry || selectedRun)) return 'metahuman_260'
    if (selectedRun === 'pretrained') return 'arkit_51'
    return null
  }, [selectedRunEntry, selectedRun])

  const glbMorphNames = useMemo(
    () => (resultData ? getGlbMorphNames(resultData) : []),
    [resultData],
  )

  /** ARKit: blendshapes_glb 순서와 data 열 인덱스 1:1 매칭 */
  const glbBlendshapeData = useMemo(() => {
    if (!resultData?.data || !glbMorphNames.length) return null
    const frameData = resultData.data[currentFrame]
    if (!frameData) return null
    const result = {}
    glbMorphNames.forEach((name, i) => {
      result[name] = Array.isArray(frameData)
        ? frameData[i]
        : (resultData.blendshapes?.[i]
          ? frameData[resultData.blendshapes[i]]
          : 0) ?? 0
    })
    return result
  }, [resultData, currentFrame, glbMorphNames])

  const inferenceCacheKey = useMemo(() => {
    if (!resultData) return ''
    const ch = resultData.channels ?? resultData.blendshapes?.length ?? 0
    return `${selectedRun}|${ch}|${resultData.frames ?? resultData.data?.length ?? 0}`
  }, [selectedRun, resultData])

  const isMetaHumanOutput = outputKind === 'metahuman_260'
  const totalFrames = resultData?.frames || resultData?.data?.length || 0
  const fps = resultData?.fps || 30

  // ---- 추론 결과 CSV 로컬 저장 ----
  const handleSaveInferenceCsv = useCallback(() => {
    if (!resultData) return
    let csvText = resultData.csvContent || null
    if (!csvText && resultData.blendshapes?.length && Array.isArray(resultData.data)) {
      const header = ['frame', 'time_sec', ...resultData.blendshapes].join(',')
      const rows = resultData.data.map((row, i) => {
        const t = (i / (fps || 30)).toFixed(6)
        const vals = Array.isArray(row) ? row : resultData.blendshapes.map((name) => row[name] ?? 0)
        return [i, t, ...vals].join(',')
      })
      csvText = [header, ...rows].join('\n')
    }
    if (!csvText) return
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const baseName = audioFileName ? audioFileName.replace(/\.[^.]+$/, '') : 'inference'
    a.download = `${baseName}_blendshape_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [resultData, fps, audioFileName])

  // ---- Speakers 관련 표시 ----
  const speakerCount = speakers?.count ?? (Array.isArray(speakers) ? speakers.length : (speakers ? 1 : 0))
  /** 화자 인덱스 i에 대한 표시 이름 (E209 등). 백엔드가 names 배열 또는 문자열 배열을 주면 사용 */
  const getSpeakerLabel = (i) => {
    if (speakers?.names?.[i] != null) return String(speakers.names[i])
    if (Array.isArray(speakers)) {
      const v = speakers[i]
      if (v != null && typeof v === 'string') return v
      if (v != null && typeof v === 'object' && v.name != null) return String(v.name)
      if (v != null && typeof v === 'object' && v.id != null) return String(v.id)
    }
    return `화자 ${i}`
  }

  return (
    <div className="h-full bg-gray-900 p-4 flex gap-4">
      {/* 왼쪽: 설정 패널 (높이 제한으로 스크롤 시 Blendshape Weight 영역이 보이도록) */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-2rem)]">
        <h2 className="text-lg font-bold text-white">서비스 추론</h2>
        <p className="text-xs text-gray-400 -mt-2">
          오디오 추론 · run 선택으로 ARKit 51 / MetaHuman 260 출력 결정
        </p>

        {/* 1. 학습 모델 선택 */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <label className="text-xs font-semibold text-gray-300 block mb-1">1. 학습 모델 (Run)</label>
          {runsLoading ? (
            <div className="text-xs text-gray-500">로딩 중...</div>
          ) : (
            <select
              value={selectedRun}
              onChange={(e) => setSelectedRun(e.target.value)}
              className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">-- 선택 --</option>
              {runGroups.arkit.length > 0 && (
                <optgroup label="ARKit 51 (GLB)">
                  {runGroups.arkit.map((run) => (
                    <option key={run.id} value={run.id}>{run.label || run.id}</option>
                  ))}
                </optgroup>
              )}
              {runGroups.metahuman.length > 0 && (
                <optgroup label="MetaHuman 260 (RigLogic)">
                  {runGroups.metahuman.map((run) => (
                    <option key={run.id} value={run.id}>{run.label || run.id}</option>
                  ))}
                </optgroup>
              )}
              {runGroups.other.length > 0 && (
                <optgroup label="기타 학습 run">
                  {runGroups.other.map((run) => (
                    <option key={run.id} value={run.id}>{run.label || run.id}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {expectedOutputKind && (
            <p className="mt-1 text-[10px] text-gray-500">
              예상 출력: {outputKindLabel(expectedOutputKind)}
            </p>
          )}
        </div>

        {/* 2. 체크포인트 선택 */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <label className="text-xs font-semibold text-gray-300 block mb-1">2. 체크포인트</label>
          {checkpointsLoading ? (
            <div className="text-xs text-gray-500">로딩 중...</div>
          ) : checkpoints.length > 0 ? (
            <select
              value={selectedCheckpoint}
              onChange={(e) => setSelectedCheckpoint(e.target.value)}
              className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {checkpoints.map(cp => (
                <option key={cp} value={cp}>{cp}</option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-gray-500">
              {selectedRun ? '체크포인트 없음' : '학습 모델을 먼저 선택하세요'}
            </div>
          )}
        </div>

        {/* 3. 오디오 업로드 */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <label className="text-xs font-semibold text-gray-300 block mb-1">3. 오디오 입력</label>
          <p className="text-xs text-gray-500 mb-2">누구의 목소리든 가능 (unseen speaker 포함)</p>
          <input
            type="file"
            accept="audio/*,.wav,.mp3"
            onChange={handleAudioSelect}
            className="w-full text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-100 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
          {audioFileName && (
            <div className="mt-1 text-xs text-green-400 truncate">{audioFileName}</div>
          )}
        </div>

        {/* 4. 화자(Identity) 선택 - 목록이 길어도 고정 높이로 스크롤하여 Blendshape Weight가 가려지지 않도록 */}
        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <label className="text-xs font-semibold text-gray-300 block mb-1">4. 화자 (Identity)</label>
          <p className="text-xs text-gray-500 mb-2">
            출력 Blendshape 스타일을 결정합니다
          </p>
          {speakersLoading ? (
            <div className="text-xs text-gray-500">로딩 중...</div>
          ) : speakerCount > 0 ? (
            <div className="max-h-32 overflow-y-auto overflow-x-hidden rounded border border-gray-600 p-1">
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: speakerCount }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedSpeaker(i)}
                    className={`px-3 py-1 text-xs rounded transition shrink-0 ${
                      selectedSpeaker === i
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {getSpeakerLabel(i)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              {selectedRun ? '화자 정보 없음' : '학습 모델을 먼저 선택하세요'}
            </div>
          )}
        </div>

        {/* 추론 실행 버튼 */}
        <button
          onClick={handleInference}
          disabled={(!localOnnxMode && !selectedRun) || !audioFile || inferenceLoading}
          className={`w-full py-3 rounded-lg font-bold text-sm transition ${
            inferenceLoading
              ? 'bg-gray-600 text-gray-400 cursor-wait'
              : !selectedRun || !audioFile
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          {inferenceLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              추론 중...
            </span>
          ) : (
            '추론 실행'
          )}
        </button>

        {/* 에러 표시 */}
        {error && (
          <div className="p-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-xs">
            {typeof error === 'string' ? error : (error?.message ?? String(error))}
          </div>
        )}

        {/* 추론 결과 정보 + CSV 저장 */}
        {resultData && (
          <div className="bg-gray-800 rounded-lg p-3 border border-green-700/50 space-y-2">
            <div className="text-xs font-semibold text-green-400">추론 완료</div>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>출력: {outputKind ? outputKindLabel(outputKind) : '—'}</div>
              <div>프레임: {totalFrames} ({fps}fps)</div>
              <div>채널: {resultData.channels ?? resultData.blendshapes?.length ?? 0}개</div>
              <div>길이: {(totalFrames / fps).toFixed(2)}초</div>
            </div>
            <button
              type="button"
              onClick={handleSaveInferenceCsv}
              className="w-full py-2 text-xs font-medium rounded bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600"
            >
              CSV 로컬 저장
            </button>
          </div>
        )}

        {/* 블렌드쉐입 값 */}
        {currentBlendshapeData && resultData?.blendshapes && (
          <div className="flex-1 min-h-0 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-2 py-1 text-xs font-semibold text-gray-300 border-b border-gray-700">
              {isMetaHumanOutput ? 'Rig Control Weight' : 'Blendshape Weight'}
            </div>
            <div className="h-64 overflow-hidden">
              <BlendshapeVisualizer
                blendshapeData={currentBlendshapeData}
                blendshapeNames={resultData.blendshapes}
              />
            </div>
          </div>
        )}
      </div>

      {/* 오른쪽: 3D 뷰어 + 재생 컨트롤 */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* 3D 뷰어 - Transform 직접 설정 후 저장 가능 */}
        <div className="flex-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden relative min-h-0">
          {resultData ? (
            <>
              {!isMetaHumanOutput && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showModelTransform}
                      onChange={(e) => setShowModelTransform(e.target.checked)}
                      className="w-4 h-4 accent-purple-600"
                    />
                    <span>Transform</span>
                  </label>
                </div>
              )}
              {isMetaHumanOutput && (
                <div className="absolute top-2 left-2 z-10 rounded bg-black/50 px-2 py-1 text-[10px] text-emerald-300">
                  MetaHuman 260 · RigLogic
                </div>
              )}
              {!isMetaHumanOutput && showModelTransform && (
                <div className="absolute top-10 left-2 z-10 bg-gray-900/95 text-white px-3 py-2 rounded-lg text-xs w-60 border border-white/10 shadow-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">Model Transform</span>
                    <button onClick={() => setShowModelTransform(false)} className="text-gray-400 hover:text-white">x</button>
                  </div>
                  {[{ key: 'x', label: 'X', color: 'text-blue-400', min: -10, max: 10 }, { key: 'y', label: 'Y', color: 'text-green-400', min: -10, max: 10 }, { key: 'z', label: 'Z', color: 'text-yellow-400', min: -10, max: 10 }].map(({ key, label, color, min, max }) => (
                    <div key={`pos-${key}`} className="mb-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-gray-400">Pos {label}</span>
                        <input type="number" step="0.01" value={modelTransform[key]} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setModelTransform(prev => ({ ...prev, [key]: v })) }} className={`w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded ${color} focus:border-blue-400 outline-none`} />
                      </div>
                      <input type="range" min={min} max={max} step="0.01" value={modelTransform[key]} onChange={(e) => setModelTransform(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))} className="w-full h-1 bg-gray-700 rounded cursor-pointer" />
                    </div>
                  ))}
                  <div className="mb-1">
                    <div className="flex justify-between items-center gap-1">
                      <span className="text-gray-400">Scale</span>
                      <input type="number" step="0.01" min="0.01" value={modelTransform.scale} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setModelTransform(prev => ({ ...prev, scale: v })) }} className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-purple-400 focus:border-blue-400 outline-none" />
                    </div>
                    <input type="range" min="0.1" max="5" step="0.01" value={modelTransform.scale} onChange={(e) => setModelTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) }))} className="w-full h-1 bg-gray-700 rounded cursor-pointer" />
                  </div>
                  {[{ key: 'rx', label: 'X' }, { key: 'ry', label: 'Y' }, { key: 'rz', label: 'Z' }].map(({ key, label }) => (
                    <div key={`rot-${key}`} className="mb-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-gray-400">Rot {label}</span>
                        <input type="number" step="0.01" value={modelTransform[key]} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setModelTransform(prev => ({ ...prev, [key]: v })) }} className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-orange-400 focus:border-blue-400 outline-none" />
                      </div>
                      <input type="range" min="-3.14" max="3.14" step="0.01" value={modelTransform[key]} onChange={(e) => setModelTransform(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))} className="w-full h-1 bg-gray-700 rounded cursor-pointer" />
                    </div>
                  ))}
                  <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                    <button onClick={() => setModelTransform(DEFAULT_TRANSFORM)} className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white">기본값 복원</button>
                    <button onClick={() => { try { localStorage.setItem('serviceViewer_transform_v1', JSON.stringify(modelTransform)); alert('Transform 저장 완료') } catch { alert('저장 실패') } }} className="w-full px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white">저장</button>
                    <button onClick={() => { navigator.clipboard.writeText(`Position: [${modelTransform.x.toFixed(2)}, ${modelTransform.y.toFixed(2)}, ${modelTransform.z.toFixed(2)}], Scale: ${modelTransform.scale.toFixed(2)}, Rotation: [${modelTransform.rx.toFixed(2)}, ${modelTransform.ry.toFixed(2)}, ${modelTransform.rz.toFixed(2)}]`); alert('값 복사됨') }} className="w-full px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white">값 복사</button>
                  </div>
                </div>
              )}
              {isMetaHumanOutput ? (
                <ServiceRigLogicViewer
                  key={inferenceCacheKey}
                  inferenceKey={inferenceCacheKey}
                  blendshapes={resultData.blendshapes || []}
                  data={resultData.data || []}
                  currentFrame={currentFrame}
                  playbackFrameRef={playbackFrameRef}
                  serverBase={serverBase}
                />
              ) : (
                <ModelViewer
                  key="service-model"
                  viewerId="service-main"
                  glbPath={glbPath}
                  cameraType="perspective"
                  currentFrame={currentFrame}
                  totalFrames={totalFrames}
                  blendshapeData={glbBlendshapeData || currentBlendshapeData}
                  blendshapeNames={glbMorphNames.length ? glbMorphNames : (resultData.blendshapes || [])}
                  position={[modelTransform.x, modelTransform.y, modelTransform.z]}
                  scale={modelTransform.scale}
                  rotation={[modelTransform.rx, modelTransform.ry, modelTransform.rz]}
                />
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-4xl mb-4 opacity-30">3D</div>
                <p className="text-sm">왼쪽에서 학습 모델과 오디오를 선택한 후</p>
                <p className="text-sm">추론을 실행하세요</p>
              </div>
            </div>
          )}
        </div>

        {/* 재생 컨트롤 */}
        {resultData && (
          <div className="mt-2 shrink-0">
            <PlaybackControls
              isPlaying={isPlaying}
              currentFrame={currentFrame}
              totalFrames={totalFrames}
              currentTime={currentFrame / fps}
              duration={totalFrames / fps}
              playbackRate={playbackRate}
              onPlay={handlePlay}
              onPause={handleStop}
              onSeek={(frame) => {
                playbackFrameRef.current = frame
                lastFrameRef.current = frame
                setCurrentFrame(frame)
                if (audioRef.current) {
                  audioRef.current.currentTime = frame / fps
                }
              }}
              onPlaybackRateChange={setPlaybackRate}
            />
          </div>
        )}

        {/* 숨겨진 오디오 요소 */}
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            className="hidden"
          />
        )}
      </div>
    </div>
  )
}
