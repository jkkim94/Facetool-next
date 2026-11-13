'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import PlaybackControls from '@/components/common/PlaybackControls'
import LocalClipPicker from '@/components/training/LocalClipPicker'
import {
  buildClipInfoFromFiles,
  clipStemFromFile,
  pairClipFiles,
  revokeAudioObjectUrl,
  tryResolveServerNpy,
  tryResolveServerWav,
} from '@/lib/eval/localClipPaths'
import {
  gtBasePathForRun,
  npyJsonToTrainingData,
  inferenceToTrainingData,
} from '@/lib/eval/gtBasePath'
import {
  detectOutputKind,
  outputKindLabel,
  normalizeRunEntry,
  filterServiceRuns,
  groupRunsForUi,
  expectedOutputKindForRun,
} from '@/lib/inference/outputKind'
import { applyArkitRemap, effectiveCompareKind, useArkitRemapPayload } from '@/lib/arkitRemap/useArkitRemap'
import { prepareArkitForGlbViewer } from '@/lib/eval/prepareArkitForGlb'
import { fetchRuns, getApiErrorMessage } from '@/lib/api/client'


const ArkitComparePanels = dynamic(
  () => import('@/components/training/ArkitComparePanels'),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-gray-500 text-xs">GLB 비교 로딩…</div> },
)

const MetaHumanComparePanels = dynamic(
  () => import('@/components/training/MetaHumanComparePanels'),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-gray-500 text-xs">RigLogic 비교 로딩…</div> },
)

const ServiceRigLogicViewer = dynamic(
  () => import('@/components/service/ServiceRigLogicViewer'),
  { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-gray-500 text-xs">RigLogic 로딩…</div> },
)

const GLB_PATH = '/models/face.glb'
const FPS_DEFAULT = 30

export default function LocalGtEvalView() {
  const [gtBasePath, setGtBasePath] = useState('E:\\DatasetGen\\D8_metahuman_control')
  const [clipName, setClipName] = useState('')
  const [clipInfo, setClipInfo] = useState(null)
  const [gtData, setGtData] = useState(null)
  const [predData, setPredData] = useState(null)
  const [gtError, setGtError] = useState(null)
  const [gtLoading, setGtLoading] = useState(false)
  const [npyFileName, setNpyFileName] = useState('')
  const [wavFileName, setWavFileName] = useState('')
  const [npyAutoFound, setNpyAutoFound] = useState(false)
  const [wavAutoFound, setWavAutoFound] = useState(false)
  const audioObjectUrlRef = useRef(null)

  const [runs, setRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState(null)
  const [selectedRun, setSelectedRun] = useState('')
  const [checkpoints, setCheckpoints] = useState([])
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('best.pt')
  const [speakers, setSpeakers] = useState(null)
  const [selectedSpeaker, setSelectedSpeaker] = useState(0)
  const [inferenceLoading, setInferenceLoading] = useState(false)
  const [error, setError] = useState(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const audioRef = useRef(null)
  const playbackFrameRef = useRef(0)
  const playbackRAFRef = useRef(null)
  const playStartTimeRef = useRef(0)
  const playStartFrameRef = useRef(0)
  const currentFrameRef = useRef(0)
  const totalFramesRef = useRef(0)
  const fpsRef = useRef(FPS_DEFAULT)
  const playbackRateRef = useRef(1.0)
  const isPlayingRef = useRef(false)

  const [serverBase, setServerBase] = useState('http://localhost:8765')
  /** false=RigLogic(MetaHuman topology), true=GLB ARKit 뷰어 */
  const [useGlbViewer, setUseGlbViewer] = useState(false)
  const [metaSource, setMetaSource] = useState(null)
  const {
    payload: arkitRemapPayload,
    loading: arkitPayloadLoading,
    error: arkitPayloadError,
  } = useArkitRemapPayload()

  useEffect(() => {
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [])

  const outputKind = useMemo(() => {
    if (predData?.outputKind) return predData.outputKind
    if (gtData?.outputKind) return gtData.outputKind
    return null
  }, [gtData, predData])

  const runGroups = useMemo(() => groupRunsForUi(runs), [runs])
  const selectedRunEntry = useMemo(
    () => runs.find((r) => r.id === selectedRun) ?? null,
    [runs, selectedRun],
  )
  const expectedOutputKind = useMemo(
    () => expectedOutputKindForRun(selectedRunEntry || selectedRun),
    [selectedRunEntry, selectedRun],
  )

  const runKind = expectedOutputKind
  const isMetaHumanRunSelected = runKind === 'metahuman_260'
  const isArkitRunSelected = runKind === 'arkit_51'

  /** 로드된 GT/Pred가 MetaHuman이면 Run 종류와 무관하게 RigLogic */
  const useRigLogicViewer = useMemo(() => {
    if (gtData?.outputKind === 'metahuman_260' || predData?.outputKind === 'metahuman_260') {
      return true
    }
    if (gtData?.outputKind === 'arkit_51' || predData?.outputKind === 'arkit_51') {
      return false
    }
    return isMetaHumanRunSelected && !useGlbViewer
  }, [gtData, predData, isMetaHumanRunSelected, useGlbViewer])

  const useArkitGlbViewer =
    !useRigLogicViewer && (isArkitRunSelected || (isMetaHumanRunSelected && useGlbViewer))
  const needsArkitRemap = isMetaHumanRunSelected && useGlbViewer && !useRigLogicViewer

  useEffect(() => {
    if (gtData?.outputKind === 'metahuman_260' || predData?.outputKind === 'metahuman_260') {
      setUseGlbViewer(false)
      return
    }
    if (isArkitRunSelected) setUseGlbViewer(true)
    else if (isMetaHumanRunSelected) setUseGlbViewer(false)
  }, [
    selectedRun,
    selectedRunEntry,
    isArkitRunSelected,
    isMetaHumanRunSelected,
    gtData?.outputKind,
    predData?.outputKind,
  ])

  const viewerGtData = useMemo(() => {
    if (!gtData || !useArkitGlbViewer) return null
    if (!needsArkitRemap) return prepareArkitForGlbViewer(gtData)
    if (gtData.outputKind === 'arkit_51') return prepareArkitForGlbViewer(gtData)
    if (!arkitRemapPayload) return null
    const remapped = applyArkitRemap(gtData, arkitRemapPayload)
    return remapped ? prepareArkitForGlbViewer(remapped) : null
  }, [gtData, useArkitGlbViewer, needsArkitRemap, arkitRemapPayload])

  const viewerPredData = useMemo(() => {
    if (!predData || !useArkitGlbViewer) return null
    if (!needsArkitRemap) return prepareArkitForGlbViewer(predData)
    if (!arkitRemapPayload) return null
    const remapped = applyArkitRemap(predData, arkitRemapPayload)
    return remapped ? prepareArkitForGlbViewer(remapped) : null
  }, [predData, useArkitGlbViewer, needsArkitRemap, arkitRemapPayload])

  const channelMismatch = useMemo(() => {
    if (!gtData || !predData) return null
    if (useRigLogicViewer) {
      if (gtData.outputKind === predData.outputKind) return null
      return `GT(${outputKindLabel(gtData.outputKind)}) vs Pred(${outputKindLabel(predData.outputKind)}) 채널 종류 불일치`
    }
    if (!runKind) return null
    const gtEff = effectiveCompareKind(gtData, runKind, useGlbViewer)
    const predEff = effectiveCompareKind(predData, runKind, useGlbViewer)
    if (gtEff && predEff && gtEff !== predEff) {
      return `GT(${outputKindLabel(gtEff)}) vs Pred(${outputKindLabel(predEff)}) 채널 종류 불일치`
    }
    return null
  }, [gtData, predData, runKind, useGlbViewer, useRigLogicViewer])

  useEffect(() => {
    if (useGlbViewer && gtError?.includes('GLB 뷰어를 켜면')) {
      setGtError(null)
    }
  }, [useGlbViewer, gtError])

  const totalFrames = useMemo(() => {
    const g = gtData?.frames || 0
    const p = predData?.frames || 0
    return Math.max(g, p, 0)
  }, [gtData, predData])

  const fps = gtData?.fps || predData?.fps || FPS_DEFAULT

  useEffect(() => {
    currentFrameRef.current = currentFrame
    playbackFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    totalFramesRef.current = totalFrames
  }, [totalFrames])

  useEffect(() => {
    fpsRef.current = fps
  }, [fps])

  useEffect(() => {
    playbackRateRef.current = playbackRate
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  const stopPlaybackLoop = useCallback(() => {
    isPlayingRef.current = false
    if (playbackRAFRef.current != null) {
      cancelAnimationFrame(playbackRAFRef.current)
      playbackRAFRef.current = null
    }
    if (audioRef.current) audioRef.current.pause()
    setIsPlaying(false)
  }, [])

  const tickPlayback = useCallback(() => {
    if (!isPlayingRef.current) return

    const total = totalFramesRef.current
    if (total <= 0) {
      stopPlaybackLoop()
      return
    }

    let frame
    const audio = audioRef.current
    if (audio && !audio.paused) {
      frame = Math.floor(audio.currentTime * fpsRef.current)
    } else {
      const elapsed = (Date.now() - playStartTimeRef.current) / 1000
      frame =
        playStartFrameRef.current
        + Math.floor(elapsed * fpsRef.current * playbackRateRef.current)
    }

    const clamped = Math.max(0, Math.min(frame, total - 1))
    playbackFrameRef.current = clamped

    if (clamped !== currentFrameRef.current) {
      currentFrameRef.current = clamped
      setCurrentFrame(clamped)
    }

    if (clamped >= total - 1) {
      stopPlaybackLoop()
      return
    }

    playbackRAFRef.current = requestAnimationFrame(tickPlayback)
  }, [stopPlaybackLoop])

  const handlePlay = useCallback(() => {
    if (totalFramesRef.current <= 0) return
    playStartTimeRef.current = Date.now()
    playStartFrameRef.current = currentFrameRef.current
    isPlayingRef.current = true
    setIsPlaying(true)

    const audio = audioRef.current
    if (audio) {
      audio.currentTime = currentFrameRef.current / fpsRef.current
      audio.playbackRate = playbackRateRef.current
      audio.play().catch(() => {})
    }

    if (playbackRAFRef.current != null) {
      cancelAnimationFrame(playbackRAFRef.current)
    }
    playbackRAFRef.current = requestAnimationFrame(tickPlayback)
  }, [tickPlayback])

  const handleStop = useCallback(() => {
    stopPlaybackLoop()
  }, [stopPlaybackLoop])

  useEffect(() => () => stopPlaybackLoop(), [stopPlaybackLoop])

  useEffect(() => {
    let cancelled = false
    const loadRuns = async () => {
      setRunsLoading(true)
      setRunsError(null)
      try {
        const d = await fetchRuns()
        if (cancelled) return
        const normalized = (d.runs || []).map(normalizeRunEntry).filter(Boolean)
        const filtered = filterServiceRuns(normalized)
        setRuns(filtered)
        if (filtered.length > 0) {
          const first = filtered[0]
          const id = first.id
          setSelectedRun(id)
          setGtBasePath(gtBasePathForRun(id))
        } else if (!d.success) {
          setRunsError(getApiErrorMessage(d))
        } else {
          setRunsError('표시할 run이 없습니다. 학습 서버 연결 또는 E:\\results_* 로컬 폴더를 확인하세요.')
        }
      } catch (e) {
        if (!cancelled) {
          setRuns([])
          setRunsError(e instanceof Error ? e.message : 'Run 목록 로드 실패')
        }
      } finally {
        if (!cancelled) setRunsLoading(false)
      }
    }
    loadRuns()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedRun) {
      setGtBasePath(gtBasePathForRun(selectedRun))
      setPredData(null)
    }
  }, [selectedRun])

  useEffect(() => {
    if (!selectedRun) {
      setCheckpoints(['best.pt'])
      setSelectedCheckpoint('best.pt')
      setSpeakers({ count: 1, names: ['Speaker 0'] })
      setMetaSource(null)
      return
    }

    setSelectedCheckpoint('best.pt')
    setSelectedSpeaker(0)
    setMetaSource(null)

    Promise.all([
      fetch(`/api/checkpoints?run=${encodeURIComponent(selectedRun)}`).then((r) => r.json()),
      fetch(`/api/speakers?run=${encodeURIComponent(selectedRun)}`).then((r) => r.json()),
    ])
      .then(([cp, sp]) => {
        const cpList =
          cp.success && Array.isArray(cp.checkpoints) && cp.checkpoints.length
            ? cp.checkpoints
            : ['best.pt']
        setCheckpoints(cpList)
        const best =
          cpList.find((c) => /^best\.pt$/i.test(c)) ||
          cpList.find((c) => /best/i.test(c)) ||
          cpList[0]
        setSelectedCheckpoint(best)

        if (sp.success && sp.speakers) {
          const norm = sp.speakers
          setSpeakers(
            Array.isArray(norm)
              ? { count: norm.length, names: norm.map(String) }
              : {
                  count: norm.count ?? 1,
                  names: norm.names ?? ['Speaker 0'],
                },
          )
        } else {
          setSpeakers({ count: 1, names: ['Speaker 0'] })
        }

        const src = cp.source || sp.source
        if (src && src !== 'backend') {
          setMetaSource(src)
        }
      })
      .catch(() => {
        setCheckpoints(['best.pt'])
        setSelectedCheckpoint('best.pt')
        setSpeakers({ count: 1, names: ['Speaker 0'] })
        setMetaSource('fallback')
      })
  }, [selectedRun])

  const handleClipFiles = useCallback(
    async (incoming) => {
      stopPlaybackLoop()

      const pair = incoming?.stem
        ? incoming
        : pairClipFiles(
            incoming?.npyFile ? [incoming.npyFile] : [],
            incoming?.wavFile ? [incoming.wavFile] : [],
          )

      let { npyFile, wavFile } = pair
      const stem =
        pair.stem ||
        clipStemFromFile(npyFile) ||
        clipStemFromFile(wavFile)

      if (!npyFile && !wavFile) return

      revokeAudioObjectUrl(audioObjectUrlRef.current)
      audioObjectUrlRef.current = null

      setNpyFileName('')
      setWavFileName('')
      setNpyAutoFound(false)
      setWavAutoFound(false)
      setClipName(stem)
      setGtError(null)
      setGtData(null)
      setPredData(null)
      setError(null)
      setClipInfo(null)
      setCurrentFrame(0)
      currentFrameRef.current = 0
      playbackFrameRef.current = 0

      let audioObjectUrl = null
      if (wavFile) {
        audioObjectUrl = URL.createObjectURL(wavFile)
        audioObjectUrlRef.current = audioObjectUrl
        setWavFileName(wavFile.name)
      }

      setGtLoading(true)
      try {
        let npyUrl = null
        let parsed = null

        if (npyFile) {
          setNpyFileName(npyFile.name)
          const fd = new FormData()
          fd.append('npy', npyFile)
          fd.append('featureRoot', gtBasePath)
          const res = await fetch('/api/file/parse-npy', { method: 'POST', body: fd })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j.error || 'GT NPY 로드 실패')
          }
          const json = await res.json()
          parsed = npyJsonToTrainingData(json, 'gt')
        } else if (wavFile && stem) {
          const serverNpy = await tryResolveServerNpy(stem, gtBasePath)
          if (!serverNpy) {
            throw new Error(
              `같은 이름의 GT NPY 없음 (${stem}.npy) — Run GT 폴더 또는 NPY를 함께 드롭하세요`,
            )
          }
          const res = await fetch(serverNpy.url)
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j.error || 'GT NPY 자동 로드 실패')
          }
          const json = await res.json()
          parsed = npyJsonToTrainingData(json, 'gt')
          npyUrl = serverNpy.url
          setNpyFileName(`${stem}.npy`)
          setNpyAutoFound(true)
        }

        if (parsed) setGtData(parsed)

        let wavUrl = null
        if (!wavFile && stem) {
          const serverWav = await tryResolveServerWav(stem, gtBasePath)
          if (serverWav) {
            wavUrl = serverWav.url
            setWavFileName(`${stem}.wav`)
            setWavAutoFound(true)
          }
        }

        const info = buildClipInfoFromFiles({
          name: stem,
          npyFile: npyFile || null,
          npyUrl,
          wavFile: wavFile || null,
          wavUrl,
          audioObjectUrl,
        })
        setClipInfo(info)

        if (parsed) {
          const expected = expectedOutputKindForRun(selectedRun)
          const gtIsArkitOnMhRun =
            expected === 'metahuman_260' && parsed.outputKind === 'arkit_51'
          const gtIsMhOnArkitRun =
            expected === 'arkit_51' && parsed.outputKind === 'metahuman_260'
          if (expected && parsed.outputKind && expected !== parsed.outputKind) {
            if (gtIsArkitOnMhRun) {
              setGtError(
                'GT가 ARKit 51입니다 — RigLogic 비교는 MetaHuman 260 NPY가 필요합니다.',
              )
            } else if (!gtIsMhOnArkitRun) {
              setGtError(
                `GT(${outputKindLabel(parsed.outputKind)})가 Run 예상(${outputKindLabel(expected)})과 다릅니다.`,
              )
            }
          }
        }

        if (!info.hasWav && npyFile) {
          setGtError((prev) => prev || `WAV 없음 (${stem}.wav) — 드롭하거나 GT 폴더에 추가하세요`)
        }
      } catch (e) {
        setGtError(e.message)
        if (audioObjectUrl) {
          revokeAudioObjectUrl(audioObjectUrl)
          audioObjectUrlRef.current = null
        }
      } finally {
        setGtLoading(false)
      }
    },
    [selectedRun, gtBasePath, stopPlaybackLoop],
  )

  useEffect(() => () => revokeAudioObjectUrl(audioObjectUrlRef.current), [])

  const handleInference = useCallback(async () => {
    if (!selectedRun || (!clipInfo?.wavFile && !clipInfo?.wavUrl)) {
      setError('Run 선택 및 WAV 필요 (선택 또는 GT 폴더 자동 매칭)')
      return
    }
    stopPlaybackLoop()
    setInferenceLoading(true)
    setError(null)
    setPredData(null)
    setCurrentFrame(0)
    currentFrameRef.current = 0
    playbackFrameRef.current = 0

    try {
      let buf
      if (clipInfo.wavFile) {
        buf = await clipInfo.wavFile.arrayBuffer()
      } else {
        const wavRes = await fetch(clipInfo.wavUrl)
        if (!wavRes.ok) throw new Error('WAV 로드 실패')
        buf = await wavRes.arrayBuffer()
      }
      const base64 = btoa(
        new Uint8Array(buf).reduce((acc, b) => acc + String.fromCharCode(b), ''),
      )
      const body = {
        run: selectedRun,
        checkpoint: selectedCheckpoint || 'best.pt',
        speaker: selectedSpeaker,
        audio_base64: base64,
        enable_eye_blink: true,
      }
      const res = await fetch('/api/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) {
        throw new Error(typeof data.error === 'string' ? data.error : '추론 실패')
      }
      const kind = detectOutputKind(data, selectedRun)
      const parsed = inferenceToTrainingData({ ...data, output_kind: kind }, 'pred')
      setPredData(parsed)

      if (
        expectedOutputKind &&
        parsed.outputKind &&
        expectedOutputKind !== parsed.outputKind &&
        !(gtData?.outputKind === 'metahuman_260' && parsed.outputKind === 'metahuman_260')
      ) {
        setError(
          `Run 예상 출력(${outputKindLabel(expectedOutputKind)}) vs Pred(${outputKindLabel(parsed.outputKind)}) 불일치`,
        )
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setInferenceLoading(false)
    }
  }, [selectedRun, selectedCheckpoint, selectedSpeaker, clipInfo, expectedOutputKind, gtData?.outputKind, stopPlaybackLoop])

  const evalKey = `${clipName}|${selectedRun}|${predData?.frames || gtData?.frames || 0}`

  const rigPanelClass =
    'relative rounded-lg overflow-hidden bg-[#1a1d24] min-h-0 h-full min-h-[280px]'

  const renderViewer = () => {
    if (!viewerGtData && !gtData) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
          왼쪽에 NPY/WAV 드롭 또는 선택
        </div>
      )
    }

    if (!runKind && !useRigLogicViewer) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
          Run을 선택하면 ARKit / MetaHuman 뷰어가 결정됩니다
        </div>
      )
    }

    if (needsArkitRemap && !arkitRemapPayload && !arkitPayloadLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-amber-400 text-sm gap-2 px-4 text-center">
          <p>ARKit Remap payload 없음 — GLB 변환 불가</p>
          <p className="text-xs text-gray-500">
            {arkitPayloadError || 'FaceTool/data/arkit_remap_payload.json 에 mapping JSON을 배치하세요'}
          </p>
        </div>
      )
    }

    const displayGt = viewerGtData ?? gtData
    const displayPred = viewerPredData ?? predData

    if (useRigLogicViewer) {
      if (gtData?.outputKind === 'arkit_51') {
        return (
          <div className="h-full flex flex-col items-center justify-center text-amber-400 text-sm gap-2 px-4 text-center">
            <p>GT가 ARKit 51 — MetaHuman RigLogic 뷰어에서 표시할 수 없습니다</p>
            <p className="text-xs text-gray-500">MetaHuman 260 NPY를 로드하세요</p>
          </div>
        )
      }
      if (!predData) {
        return (
          <div className="flex flex-col h-full min-h-0 gap-2">
            <div className={rigPanelClass}>
              <span className="absolute top-2 left-2 z-10 text-xs bg-green-600/90 px-2 py-0.5 rounded text-white">
                GT (RigLogic)
              </span>
              <ServiceRigLogicViewer
                inferenceKey={`gt-${evalKey}`}
                blendshapes={gtData.blendshapes}
                data={gtData.data}
                currentFrame={currentFrame}
                playbackFrameRef={playbackFrameRef}
                serverBase={serverBase}
              />
            </div>
            <p className="text-center text-gray-500 text-xs shrink-0">
              GT {gtData.frames} frames — 추론 실행
            </p>
          </div>
        )
      }
      return (
        <div className="relative flex flex-col h-full min-h-0">
          <span className="absolute top-0 right-0 z-10 text-[10px] bg-black/50 px-2 py-0.5 rounded text-purple-300">
            MetaHuman 260 (RigLogic)
          </span>
          <MetaHumanComparePanels
            gtData={gtData}
            predData={predData}
            serverBase={serverBase}
            evalKey={evalKey}
            currentFrame={currentFrame}
            playbackFrameRef={playbackFrameRef}
            isPlaying={isPlaying}
          />
        </div>
      )
    }

    if (useArkitGlbViewer) {
      const remapLabel = needsArkitRemap ? ' (MH→ARKit Remap)' : ''
      return (
        <div className="relative">
          <span className="absolute top-0 right-0 z-10 text-[10px] bg-black/50 px-2 py-0.5 rounded text-blue-300">
            ARKit 51 (GLB){remapLabel}
          </span>
          <ArkitComparePanels
            gtData={displayGt}
            predData={displayPred}
            audioRef={audioRef}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            currentFrame={currentFrame}
            glbUrl={GLB_PATH}
          />
        </div>
      )
    }

    return (
      <div className="h-full flex items-center justify-center text-amber-400 text-sm">
        지원하지 않는 출력 종류입니다 ({runKind || outputKind})
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-3 gap-2">
      <header className="shrink-0">
        <h1 className="text-lg font-bold text-white">로컬 GT vs Prediction</h1>
        <p className="text-xs text-gray-400">
          Run → ARKit / MetaHuman 모두 GT vs Pred · 와이어프레임 · Signed Distance
        </p>
      </header>

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className="w-56 xl:w-60 shrink-0 flex flex-col min-h-0 bg-gray-800/80 border border-gray-700 rounded-lg overflow-hidden p-2">
          <div className="text-[10px] text-gray-400 mb-2 shrink-0 truncate" title={gtBasePath}>
            Run GT 폴더: <span className="text-cyan-400">{gtBasePath.split('\\').pop()}</span>
          </div>
          <LocalClipPicker
            expectedOutputKind={expectedOutputKind}
            outputKindLabel={outputKindLabel}
            onFilesDrop={handleClipFiles}
            npyLoading={gtLoading}
            npyFileName={npyFileName}
            wavFileName={wavFileName}
            npyAutoFound={npyAutoFound}
            wavAutoFound={wavAutoFound}
          />
        </aside>

        <section className="flex-1 flex flex-col min-w-0 min-h-0 gap-2">
          <div className="shrink-0 flex flex-wrap gap-2 items-end bg-white/5 border border-white/10 rounded-lg p-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Run</label>
                <select
                  value={selectedRun}
                  onChange={(e) => setSelectedRun(e.target.value)}
                  disabled={runsLoading}
                  className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-white min-w-[220px] disabled:opacity-50"
                >
                  <option value="">
                    {runsLoading ? 'Run 로딩…' : runs.length ? '-- 선택 --' : '-- run 없음 --'}
                  </option>
                  {runGroups.arkit.length > 0 && (
                    <optgroup label="ARKit 51 (GLB)">
                      {runGroups.arkit.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.label || run.id}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {runGroups.metahuman.length > 0 && (
                    <optgroup label="MetaHuman 260 (RigLogic)">
                      {runGroups.metahuman.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.label || run.id}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {runGroups.other.length > 0 && (
                    <optgroup label="기타 학습 run">
                      {runGroups.other.map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.label || run.id}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {expectedOutputKind && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    예상 출력: {outputKindLabel(expectedOutputKind)}
                  </p>
                )}
                {runsError && (
                  <p className="mt-1 text-[10px] text-amber-400 max-w-[320px] leading-snug">
                    {runsError}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Checkpoint</label>
                <select
                  value={selectedCheckpoint}
                  onChange={(e) => setSelectedCheckpoint(e.target.value)}
                  className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-white min-w-[140px]"
                >
                  {(checkpoints.length ? checkpoints : ['best.pt']).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {metaSource && metaSource !== 'backend' && (
                  <p className="mt-0.5 text-[10px] text-amber-500">로컬 .pt 스캔</p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">화자</label>
                <select
                  value={selectedSpeaker}
                  onChange={(e) => setSelectedSpeaker(Number(e.target.value))}
                  className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded text-white"
                >
                  {Array.from(
                    { length: speakers?.count ?? 1 },
                    (_, i) => (
                      <option key={i} value={i}>
                        {speakers?.names?.[i] ?? `화자 ${i}`}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <button
                type="button"
                onClick={handleInference}
                disabled={!clipInfo?.hasWav || !selectedRun || inferenceLoading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium"
              >
                {inferenceLoading ? '추론 중...' : '추론 (Prediction)'}
              </button>
              <label
                className={`flex flex-col gap-0.5 text-xs px-2 py-1.5 rounded border cursor-pointer ${
                  useGlbViewer
                    ? 'border-cyan-600/50 text-cyan-200 bg-cyan-950/20'
                    : 'border-purple-600/50 text-purple-200 bg-purple-950/20'
                } ${isArkitRunSelected || useRigLogicViewer ? 'opacity-70 cursor-default' : ''}`}
                title={
                  useGlbViewer
                    ? 'GLB face.glb — ARKit morph (MetaHuman run은 Remap 적용)'
                    : 'MetaHuman RigLogic topology — DNA/RigLogic 메쉬'
                }
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useGlbViewer}
                    disabled={isArkitRunSelected || useRigLogicViewer}
                    onChange={(e) => setUseGlbViewer(e.target.checked)}
                    className="accent-cyan-500"
                  />
                  GLB (ARKit) 뷰어
                </span>
                <span className="text-[10px] text-gray-500 pl-5">
                  {useGlbViewer
                    ? isMetaHumanRunSelected
                      ? 'MH control → ARKit Remap'
                      : 'ARKit morph'
                    : 'MetaHuman topology'}
                </span>
                {useGlbViewer && isMetaHumanRunSelected && !arkitRemapPayload && !arkitPayloadLoading && (
                  <span className="text-[10px] text-amber-500 pl-5">Remap payload 없음</span>
                )}
              </label>
              {clipName && (
                <span className="text-xs text-gray-500 ml-auto text-right truncate max-w-[240px]" title={clipInfo?.npyPath}>
                  {clipName}
                  {runKind && (
                    <span className="ml-2 text-emerald-400">
                      {useRigLogicViewer
                        ? 'MetaHuman (RigLogic)'
                        : useArkitGlbViewer
                          ? needsArkitRemap
                            ? 'GLB (Remap)'
                            : 'ARKit 51 (GLB)'
                          : 'MetaHuman (RigLogic)'}
                    </span>
                  )}
                </span>
              )}
            </div>

          {(gtError || error || channelMismatch) && (
            <div className="shrink-0 p-2 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-xs">
              {gtError || error || channelMismatch}
            </div>
          )}

          <div className="flex-1 min-h-0 bg-white/5 border border-white/10 rounded-lg p-2 overflow-hidden flex flex-col">
            {renderViewer()}
          </div>

          {(clipInfo?.audioObjectUrl || clipInfo?.wavUrl) && (
            <audio
              ref={audioRef}
              src={clipInfo.audioObjectUrl || clipInfo.wavUrl}
              preload="auto"
              className="hidden"
            />
          )}

          {totalFrames > 0 && (
            <div className="shrink-0">
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
                  currentFrameRef.current = frame
                  setCurrentFrame(frame)
                  playbackFrameRef.current = frame
                  if (audioRef.current) audioRef.current.currentTime = frame / fpsRef.current
                }}
                onPlaybackRateChange={setPlaybackRate}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
