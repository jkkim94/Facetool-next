/**
 * ============================================================================
 * EpochFolderSelector: 에폭 폴더 선택 컴포넌트
 * ============================================================================
 * 
 * 서버 경로를 입력하여 에폭별 학습 결과를 로드합니다.
 * ============================================================================
 */

'use client'

import { useState, useCallback, useEffect } from 'react'

// 기본 Run (API 실패 시 폴백)
const DEFAULT_RUN = 'results_d8_speaker_internal_lr3e5'
const FALLBACK_RUNS = [
  { id: 'results_d8_speaker_internal_lr3e5', epochCount: 0 },
  { id: 'results_d8_speaker_internal', epochCount: 0 },
  { id: 'results_d8_speaker_independent', epochCount: 0 },
  { id: 'results', epochCount: 0 },
]

export default function EpochFolderSelector({ onEpochLoad, disabled }) {
  const [folderPath, setFolderPath] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingRuns, setIsLoadingRuns] = useState(true)
  const [error, setError] = useState(null)
  const [availableFolders, setAvailableFolders] = useState([])
  const [runs, setRuns] = useState([])
  const [baseDir, setBaseDir] = useState(null)
  const [isFallbackRuns, setIsFallbackRuns] = useState(false)  // API 실패 시 폴백 목록 표시 여부
  const [selectedRun, setSelectedRun] = useState(DEFAULT_RUN)
  const [inferenceClipLabels, setInferenceClipLabels] = useState({})

  const handleLoad = useCallback(async () => {
    const pathTrim = folderPath.trim()
    if (!pathTrim || !onEpochLoad) return

    setIsLoading(true)
    setError(null)

    try {
      const requestBody = { run: selectedRun }
      if (pathTrim.includes('/') && !pathTrim.startsWith('epoch_')) {
        const [folderPathPart, ...rest] = pathTrim.split('/')
        const baseName = rest.join('/')
        requestBody.folderPath = folderPathPart
        requestBody.csvFileName = baseName.includes('.') ? baseName : `${baseName}.csv`
      } else {
        requestBody.folderPath = pathTrim
      }

      const res = await fetch('/api/epoch/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })


      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to load epoch folder')
      }

      const data = await res.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load epoch folder')
      }

      onEpochLoad({
        ...data,
        run: selectedRun,
        folderPath: requestBody.folderPath || pathTrim,
      })
    } catch (err) {
      console.error('Epoch folder load failed:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [folderPath, onEpochLoad, selectedRun])

  const handleQuickSelect = useCallback((epochName) => {
    setFolderPath(epochName)
  }, [])

  // best, best1 등 폴더를 GET /api/epoch/files 로 펼쳐서 클립 목록(폴더/파일명)으로 변환. inference_debug일 때 원본 오디오 이름 라벨 반환
  const expandFolderToClips = useCallback(async (folderName) => {
    try {
      const res = await fetch(
        `/api/epoch/files?run=${encodeURIComponent(selectedRun)}&folderPath=${encodeURIComponent(folderName)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return folderName === 'inference_debug' ? { clips: [], inferenceLabels: {} } : []
      const data = await res.json()
      const files = data.files || []
      const isInferenceDebug = folderName === 'inference_debug'
      const inferenceLabels = {}
      const csvBases = []
      for (const f of files) {
        if (f.type !== 'csv') continue
        const base = (f.name || '').replace(/\.csv$/i, '')
        if (!base) continue
        if (isInferenceDebug && base.endsWith('_gt')) continue
        csvBases.push(base)
        if (isInferenceDebug && f.sourceAudioFilename) {
          inferenceLabels[`${folderName}/${base}`] = f.sourceAudioFilename
        }
      }
      const clips = [...new Set(csvBases)].map(base => `${folderName}/${base}`)
      if (isInferenceDebug) return { clips, inferenceLabels }
      return clips
    } catch {
      return folderName === 'inference_debug' ? { clips: [], inferenceLabels: {} } : []
    }
  }, [selectedRun])

  // 에폭 폴더 목록 불러오기 (best/best1 은 /api/epoch/files 로 펼쳐서 CSV 클립 목록 표시)
  const loadFolderList = useCallback(async () => {
    setIsLoadingList(true)
    try {
      const url = `/api/epoch/list?run=${encodeURIComponent(selectedRun)}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        console.warn('Failed to load epoch folder list')
        return
      }
      const data = await res.json()
      const epochList = data.epochs || data.folders || []
      if (!data.success || !epochList.length) {
        setAvailableFolders([])
        return
      }

      const isLocalClip = (e) => typeof e === 'string' && e.includes('/') && !e.startsWith('epoch_')
      const isExpandableFolder = (e) => typeof e === 'string' && (/^best\d*$/i.test(e.trim()) || e.trim() === 'inference_debug')

      const expanded = []
      for (const item of epochList) {
        if (isExpandableFolder(item)) {
          const result = await expandFolderToClips(item)
          const clips = Array.isArray(result) ? result : result.clips || []
          if (result && !Array.isArray(result) && result.inferenceLabels) {
            setInferenceClipLabels((prev) => ({ ...prev, ...result.inferenceLabels }))
          }
          if (clips.length > 0) {
            expanded.push(...clips)
          } else {
            expanded.push(item)
          }
        } else {
          expanded.push(item)
        }
      }

      const isInferenceClip = (e) => typeof e === 'string' && e.startsWith('inference_debug/')
      const notInferenceGt = (e) => !e.replace(/^inference_debug\//, '').endsWith('_gt')
      const localClips = expanded.filter(e => isLocalClip(e) && !isInferenceClip(e))
      const inferenceClips = expanded.filter(isInferenceClip).filter(notInferenceGt)
      const trainEpochs = expanded.filter(e => !isLocalClip(e) && !isInferenceClip(e) && e.includes('train'))
      const normalEpochs = expanded.filter(e => !isLocalClip(e) && !isInferenceClip(e) && !e.includes('train'))

      const sortByNum = (a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0')
        const numB = parseInt(b.match(/\d+/)?.[0] || '0')
        return numB - numA
      }

      const sorted = [
        ...inferenceClips.sort(),
        ...localClips.sort(),
        ...trainEpochs.sort(sortByNum),
        ...normalEpochs.sort(sortByNum),
      ]
      setAvailableFolders(sorted)
    } catch (err) {
      console.error('Failed to load epoch folder list:', err)
    } finally {
      setIsLoadingList(false)
    }
  }, [selectedRun, expandFolderToClips])

  // 결과 폴더 목록 불러오기 (GET /api/runs)
  const loadRuns = useCallback(async () => {
    setIsLoadingRuns(true)
    try {
      const res = await fetch('/api/runs', { cache: 'no-store' })
      const data = await res.json()
      if (data.success && data.runs?.length > 0) {
        setRuns(data.runs)
        setBaseDir(data.baseDir || null)
        setIsFallbackRuns(false)
        setSelectedRun((prev) => {
          const runId = (r) => (typeof r === 'string' ? r : (r?.id ?? r))
          const exists = data.runs.some((r) => runId(r) === prev)
          return exists ? prev : runId(data.runs[0])
        })
      } else {
        setRuns(FALLBACK_RUNS.map((r) => ({ ...r, epochCount: 0 })))
        setBaseDir(null)
        setIsFallbackRuns(true)
      }
    } catch (err) {
      console.error('Failed to load runs:', err)
      setRuns(FALLBACK_RUNS)
      setBaseDir(null)
      setIsFallbackRuns(true)
    } finally {
      setIsLoadingRuns(false)
    }
  }, [])

  // 초기 로드 + 30초마다 자동 새로고침
  useEffect(() => {
    loadRuns()
    
    // 30초마다 자동 새로고침
    const intervalId = setInterval(() => {
      console.log('[EpochFolderSelector] Auto-refreshing runs list...')
      loadRuns()
    }, 30000)
    
    return () => clearInterval(intervalId)
  }, [loadRuns])

  // run 변경 시 폴더 목록 불러오기 + 추론 라벨 초기화
  useEffect(() => {
    setInferenceClipLabels({})
    if (!isLoadingRuns) loadFolderList()
  }, [loadFolderList, selectedRun, isLoadingRuns])

  return (
    <div className="border-2 border-dashed border-purple-500 rounded-xl p-6 bg-purple-500/5">
      <div className="space-y-4">
        {/* Run 선택 (GET /api/runs - results, results_* 접두사 스캔, 수정시간 최신순) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-white text-sm font-medium">
              실행 환경 (Run)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">수정시간 최신순</span>
              <button
                onClick={loadRuns}
                disabled={disabled || isLoadingRuns}
                className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50 transition"
              >
                {isLoadingRuns ? '로딩...' : '새로고침'}
              </button>
            </div>
          </div>
          {isLoadingRuns ? (
            <div className="text-gray-500 text-xs py-2">Run 목록 로딩 중...</div>
          ) : isFallbackRuns ? (
            <div className="space-y-2">
              <div className="p-2 bg-red-500/20 rounded border border-red-500/30 text-xs text-red-300">
                백엔드 연결 실패. 아래는 예시 목록이며, 실제 서버에 없을 수 있습니다.
              </div>
              <div className="flex flex-wrap gap-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run.id)}
                    disabled={disabled || isLoading}
                    className="px-3 py-2 rounded text-sm font-medium bg-white/5 text-gray-400 border border-gray-600"
                  >
                    <span className="block">{run.id}</span>
                    <span className="block text-xs opacity-70">(폴백)</span>
                  </button>
                ))}
              </div>
            </div>
          ) : runs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {runs.map((run) => {
                const runId = typeof run === 'string' ? run : (run?.id ?? run)
                return (
                  <button
                    key={runId}
                    onClick={() => setSelectedRun(runId)}
                    disabled={disabled || isLoading}
                    title={typeof run === 'object' ? (run.blendshapePath || run.path || runId) : runId}
                    className={`px-3 py-2 rounded text-sm font-medium transition ${
                      selectedRun === runId
                        ? runId === 'results'
                          ? 'bg-blue-600 text-white'
                          : 'bg-purple-600 text-white'
                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    } disabled:opacity-50`}
                  >
                    <span className="block">{runId}</span>
                    <span className="block text-xs opacity-70">{typeof run === 'object' ? (run.epochCount ?? 0) : 0} epochs</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-gray-500 text-xs py-2">사용 가능한 Run이 없습니다</div>
          )}
        </div>
        
        <div>
          <label className="block text-white text-sm font-medium mb-2">
            에폭 폴더 경로
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="epoch_001 또는 best/clip이름 등"
              disabled={disabled || isLoading}
              className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !disabled && !isLoading) {
                  handleLoad()
                }
              }}
            />
            <button
              onClick={handleLoad}
              disabled={disabled || isLoading || !folderPath.trim()}
              className={`px-4 py-2 ${selectedRun === 'results' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} disabled:bg-gray-600 disabled:opacity-50 text-white rounded font-medium transition`}
            >
              {isLoading ? '로딩...' : '로드'}
            </button>
          </div>
          <p className="text-gray-400 text-xs mt-1">
            예: epoch_001, epoch_002, epoch_003 등
            {selectedRun && <span className="text-gray-500 ml-2">(run: {selectedRun})</span>}
          </p>
        </div>

        {/* 사용 가능한 에폭 폴더 목록 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-400 text-xs">사용 가능한 에폭:</p>
            <button
              onClick={loadFolderList}
              disabled={disabled || isLoadingList}
              className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50 transition"
            >
              {isLoadingList ? '새로고침...' : '🔄 새로고침'}
            </button>
          </div>
          {isLoadingList ? (
            <div className="text-gray-500 text-xs py-2">로딩 중...</div>
          ) : availableFolders.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableFolders.map((folder) => {
                // inference_debug/xxx, best/clip1, best1/xxx 형식(로컬 클립) vs epoch_001 형식 구분
                const isInferenceClip = folder.startsWith('inference_debug/')
                const isLocalClip = folder.includes('/') && !folder.startsWith('epoch_')
                const isTrain = !isLocalClip && folder.includes('train')
                const epochNum = folder.match(/\d+/)?.[0] || ''
                const label = isInferenceClip
                  ? (inferenceClipLabels[folder] ? `[추론] ${inferenceClipLabels[folder]}` : folder.replace('inference_debug/', '[추론] '))
                  : isLocalClip
                    ? folder
                    : isTrain
                      ? `Train ${epochNum}`
                      : epochNum
                        ? `Epoch ${epochNum}`
                        : folder
                return (
                  <button
                    key={folder}
                    onClick={() => {
                      handleQuickSelect(folder)
                      handleLoad()
                    }}
                    disabled={disabled || isLoading}
                    className={`px-3 py-1 disabled:opacity-50 border rounded text-xs transition ${
                      isInferenceClip
                        ? 'bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/30 text-orange-300'
                        : isLocalClip
                          ? 'bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-500/30 text-cyan-300'
                          : isTrain
                            ? 'bg-green-500/20 hover:bg-green-500/30 border-green-500/30 text-green-300'
                            : 'bg-purple-500/20 hover:bg-purple-500/30 border-purple-500/30 text-purple-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-gray-500 text-xs py-2">사용 가능한 에폭 폴더가 없습니다</div>
              <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 text-xs text-amber-200">
                <p className="font-medium mb-1">에폭이 없을 때 확인:</p>
                <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
                  <li>로컬 모드: Run 폴더/blendshape_samples/best(또는 best1 등) 안에 CSV+WAV 쌍이 있는지 확인</li>
                  <li>백엔드 모드: EPOCH_API_URL이 데이터가 있는 머신을 가리키는지 확인</li>
                  {baseDir && <li>스캔 경로: {baseDir}</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

