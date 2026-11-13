/**
 * ============================================================================
 * DatasetView - Tab 1: 데이터셋 검증
 * ============================================================================
 * 
 * DataValid 프로젝트에서 이관. 불필요한 모드(VideoProcessor, JitterCompare) 제거.
 * 
 * 기능:
 *   - 파일 브라우저로 데이터셋 탐색 (NPY/CSV/WAV/MP4)
 *   - 비디오 + 3D 모델 동기화 재생
 *   - 프레임 단위 탐색 및 비교 (Exact Frame Mode)
 *   - 블렌드쉐입 값 실시간 시각화
 *   - 동기화 검증 (비디오 위 3D 오버레이)
 * ============================================================================
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import FileBrowser from '@/components/dataset/FileBrowser'
import DatasetViewer from '@/components/dataset/DatasetViewer'
import { parseLocalBlendshapeCsv } from '@/lib/parseLocalBlendshapeCsv'

export default function DatasetView() {
  const [blendshapeData, setBlendshapeData] = useState(null)
  const [glbPath, setGlbPath] = useState('/models/face.glb')
  const [fps, setFps] = useState(30)
  const [error, setError] = useState(null)
  const [showFileBrowser, setShowFileBrowser] = useState(true)
  const [currentFileName, setCurrentFileName] = useState(null)
  const [currentSplit, setCurrentSplit] = useState('')
  const [currentBasePath, setCurrentBasePath] = useState('E:\\DatasetGen')
  const [isDragging, setIsDragging] = useState(false)
  const [currentFileInfo, setCurrentFileInfo] = useState(null)

  // E209/ComfyUI 경로면 25fps, 5015 2D 60fps 경로면 60fps 자동 적용
  useEffect(() => {
    if (!currentBasePath) return
    if (currentBasePath.includes('E209') || currentBasePath.includes('comfyui')) {
      setFps(25)
    } else if (currentBasePath.includes('5015_2D')) {
      setFps(60)
    }
  }, [currentBasePath])

  const applyDetectedFps = useCallback((data) => {
    if (data?.detectedFps && data.detectedFps > 0) {
      const rounded = Math.round(data.detectedFps)
      if ([25, 30, 60].includes(rounded)) {
        setFps(rounded)
      } else if (data.detectedFps >= 55) {
        setFps(60)
      } else if (data.detectedFps >= 28) {
        setFps(30)
      }
    }
  }, [])

  const parseCsvText = useCallback((csvText) => {
    const parsed = parseLocalBlendshapeCsv(csvText)
    return {
      frames: parsed.frames,
      blendshapeNames: parsed.blendshapeNames,
      totalFrames: parsed.totalFrames,
      timeSec: parsed.timeSec,
      duration: parsed.duration,
      detectedFps: parsed.detectedFps,
      hasTimeSec: parsed.hasTimeSec,
    }
  }, [])

  // 파일 브라우저에서 파일 선택
  const handleFileSelect = useCallback(async (fileInfo) => {
    console.log('[FileBrowser] 파일 선택:', fileInfo)
    setCurrentFileName(fileInfo.name)
    setCurrentSplit(fileInfo.split || '')
    setCurrentBasePath(fileInfo.basePath || currentBasePath)
    setCurrentFileInfo(fileInfo)
    setError(null)

    try {
      let data = null

      if (fileInfo.hasNpy && fileInfo.npyUrl) {
        const npyRes = await fetch(fileInfo.npyUrl)
        if (!npyRes.ok) throw new Error('NPY 로드 실패')
        data = await npyRes.json()
        // companion CSV가 있으면 time_sec / FPS 메타 로드
        if (fileInfo.hasCsv && fileInfo.csvUrl) {
          try {
            const csvRes = await fetch(fileInfo.csvUrl)
            if (csvRes.ok) {
              const meta = parseCsvText(await csvRes.text())
              data = {
                ...data,
                timeSec: meta.timeSec,
                duration: meta.duration,
                detectedFps: meta.detectedFps,
                hasTimeSec: meta.hasTimeSec,
              }
            }
          } catch { /* NPY 단독 재생은 WAV 기반 FPS 추정으로 fallback */ }
        }
      } else if (fileInfo.hasCsv && fileInfo.csvUrl) {
        const csvRes = await fetch(fileInfo.csvUrl)
        if (!csvRes.ok) throw new Error('CSV 로드 실패')
        data = parseCsvText(await csvRes.text())
      } else if (fileInfo.dataUrl) {
        const res = await fetch(fileInfo.dataUrl)
        if (!res.ok) throw new Error('데이터 로드 실패')
        const contentType = res.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          data = await res.json()
        } else {
          data = parseCsvText(await res.text())
        }
      } else {
        throw new Error('데이터 파일(NPY 또는 CSV)이 없습니다')
      }

      applyDetectedFps(data)
      setBlendshapeData(data)
    } catch (err) {
      console.error('[FileBrowser] 파일 로드 오류:', err)
      setError(err.message)
    }
  }, [currentBasePath, applyDetectedFps, parseCsvText])

  // 드래그앤드롭
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const csvFile = files.find(f => f.name.endsWith('.csv'))

    if (!csvFile) {
      setError('CSV 파일을 드롭해주세요')
      return
    }

    const baseName = csvFile.name.replace(/\.csv$/, '')
    setCurrentFileName(baseName)
    setError(null)

    try {
      const csvText = await csvFile.text()
      const parsed = parseCsvText(csvText)
      applyDetectedFps(parsed)
      setBlendshapeData(parsed)
    } catch (err) {
      setError(err.message)
    }
  }, [applyDetectedFps, parseCsvText])

  return (
    <div className="h-full bg-gray-900 p-2 flex flex-col">
      {/* 상단 도구 */}
      <div className="mb-2 p-2 bg-gray-800 border border-gray-700 rounded shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">데이터셋 검증</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-300">
              <span>FPS:</span>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value={25}>25 (ComfyUI)</option>
                <option value={30}>30</option>
                <option value={60}>60 (5015 2D)</option>
              </select>
            </label>
            <button
              onClick={() => setShowFileBrowser(!showFileBrowser)}
              className={`px-3 py-1.5 rounded font-semibold text-xs ${
                showFileBrowser
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {showFileBrowser ? 'Dataset Browser ON' : 'Dataset Browser OFF'}
            </button>
            {currentFileName && (
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
                {currentFileName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 메인 뷰어 */}
      <div
        className={`flex gap-2 mb-2 flex-1 min-h-0 ${isDragging ? 'ring-2 ring-blue-500 ring-opacity-50' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-blue-900 bg-opacity-30 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-800 border-2 border-dashed border-blue-500 rounded-xl p-8 text-center">
              <div className="text-lg text-gray-300">CSV / NPY 파일을 여기에 드롭</div>
            </div>
          </div>
        )}

        {showFileBrowser && (
          <div className="w-64 flex-shrink-0 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden">
            <FileBrowser
              onFileSelect={handleFileSelect}
              onBasePathChange={(path) => setCurrentBasePath(path)}
            />
          </div>
        )}

        {currentFileName ? (
          <DatasetViewer
            fileName={currentFileName}
            blendshapeData={blendshapeData}
            fps={fps}
            glbPath={glbPath}
            split={currentSplit}
            basePath={currentBasePath}
            fileInfo={currentFileInfo}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-800 border border-gray-700 rounded-lg">
            <div className="text-center text-gray-500">
              <p className="text-sm">Dataset Browser에서 파일을 선택하세요</p>
            </div>
          </div>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mb-2 p-2 bg-red-900/50 border border-red-700 text-red-300 rounded text-xs shrink-0">
          {error}
        </div>
      )}

    </div>
  )
}
