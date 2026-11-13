'use client'

import { useState, useEffect, useCallback } from 'react'
import ClipBrowser from '@/components/dataset-builder/ClipBrowser'
import SegmentEditor from '@/components/dataset-builder/SegmentEditor'

export default function DatasetBuilderView() {
  const [clips, setClips] = useState([])
  const [clipsLoading, setClipsLoading] = useState(false)
  const [clipsError, setClipsError] = useState(null)

  const [selectedId, setSelectedId] = useState(null)
  const [clipData, setClipData] = useState(null)
  const [clipLoading, setClipLoading] = useState(false)
  const [clipError, setClipError] = useState(null)

  // Load clip list
  useEffect(() => {
    setClipsLoading(true)
    setClipsError(null)
    fetch('/api/dataset-builder/clips')
      .then(r => r.json())
      .then(data => {
        if (data.success) setClips(data.clips)
        else setClipsError(data.error || '클립 목록 로드 실패')
      })
      .catch(err => setClipsError(err.message))
      .finally(() => setClipsLoading(false))
  }, [])

  // Load single clip
  const handleSelect = useCallback(id => {
    if (id === selectedId) return
    setSelectedId(id)
    setClipData(null)
    setClipError(null)
    setClipLoading(true)
    fetch(`/api/dataset-builder/clip?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setClipData(data)
        else setClipError(data.error || '클립 로드 실패')
      })
      .catch(err => setClipError(err.message))
      .finally(() => setClipLoading(false))
  }, [selectedId])

  // Refresh clip status in list after save
  const handleSave = useCallback(sampleId => {
    fetch('/api/dataset-builder/clips')
      .then(r => r.json())
      .then(data => { if (data.success) setClips(data.clips) })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: clip browser */}
      {clipsLoading ? (
        <div className="w-72 shrink-0 flex items-center justify-center bg-gray-900 border-r border-white/10 text-gray-500 text-sm">
          클립 로딩 중…
        </div>
      ) : clipsError ? (
        <div className="w-72 shrink-0 flex items-center justify-center bg-gray-900 border-r border-white/10 text-red-400 text-sm px-4 text-center">
          {clipsError}
        </div>
      ) : (
        <ClipBrowser
          clips={clips}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      )}

      {/* Right: editor */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {!selectedId && (
          <div className="h-full flex flex-col items-center justify-center text-gray-600">
            <div className="text-lg mb-2">Dataset Builder</div>
            <div className="text-sm">왼쪽에서 클립을 선택하세요</div>
            <div className="text-xs mt-4 text-gray-700">
              {clips.length > 0 ? `${clips.length}개 클립 로드됨` : ''}
            </div>
          </div>
        )}
        {selectedId && clipLoading && (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            클립 로딩 중…
          </div>
        )}
        {selectedId && clipError && (
          <div className="h-full flex items-center justify-center text-red-400 text-sm px-8 text-center">
            {clipError}
          </div>
        )}
        {selectedId && !clipLoading && !clipError && clipData && (
          <SegmentEditor
            clipData={clipData}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  )
}
