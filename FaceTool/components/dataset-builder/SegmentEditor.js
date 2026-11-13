'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SegmentTimeline from './SegmentTimeline'

const STATUS_LABEL = {
  draft: { text: 'draft', cls: 'bg-gray-600 text-gray-200' },
  auto_aligned: { text: 'auto', cls: 'bg-blue-700 text-blue-100' },
  manual_edited: { text: '수정됨', cls: 'bg-purple-700 text-purple-100' },
  review_required: { text: '검수필요', cls: 'bg-yellow-700 text-yellow-100' },
  approved: { text: '승인 ✓', cls: 'bg-green-700 text-green-100' },
  rejected: { text: '제외', cls: 'bg-red-800 text-red-200' },
}

function fmt(sec) {
  const s = Math.floor(sec)
  const ms = Math.round((sec - s) * 100)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

export default function SegmentEditor({ clipData, onSave }) {
  const [segments, setSegments] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loopSeg, setLoopSeg] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState(null)
  const audioRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!clipData) return
    setSegments(clipData.segments || [])
    setSelectedId(clipData.segments?.[0]?.id || null)
    setCurrentTime(0)
    setIsPlaying(false)
  }, [clipData?.sampleId])

  const selectedSeg = segments.find(s => s.id === selectedId)

  // Audio time sync
  const syncTime = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentTime(audio.currentTime)
    if (loopSeg && selectedSeg && audio.currentTime >= selectedSeg.endSec) {
      audio.currentTime = selectedSeg.startSec
    }
    rafRef.current = requestAnimationFrame(syncTime)
  }, [loopSeg, selectedSeg])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => { rafRef.current = requestAnimationFrame(syncTime); setIsPlaying(true) }
    const onPause = () => { cancelAnimationFrame(rafRef.current); setIsPlaying(false) }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      cancelAnimationFrame(rafRef.current)
    }
  }, [syncTime])

  const handleTimeClick = useCallback(t => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = t
    setCurrentTime(t)
  }, [])

  const handleSegmentSelect = useCallback(id => {
    setSelectedId(id)
  }, [])

  const handleSegmentChange = useCallback((segId, edge, newTime) => {
    setSegments(prev => prev.map(s => {
      if (s.id !== segId) return s
      const updated = { ...s, source: 'manual_edited', status: s.status === 'approved' ? 'manual_edited' : s.status }
      if (edge === 'start') {
        const clamped = Math.min(newTime, s.endSec - 0.3)
        updated.startSec = Math.max(0, clamped)
        updated.startFrame = Math.floor(updated.startSec * 30)
      } else {
        const clamped = Math.max(newTime, s.startSec + 0.3)
        updated.endSec = Math.min(clipData.durationSec, clamped)
        updated.endFrame = Math.ceil(updated.endSec * 30)
      }
      return updated
    }))
  }, [clipData?.durationSec])

  const handleSetStatus = useCallback((segId, status) => {
    setSegments(prev => prev.map(s => s.id === segId ? { ...s, status } : s))
  }, [])

  const handlePlaySegment = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !selectedSeg) return
    audio.currentTime = selectedSeg.startSec
    audio.play()
  }, [selectedSeg])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/dataset-builder/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: clipData.sampleId, segments }),
      })
      const data = await res.json()
      setMessage(data.success ? `저장 완료 (${data.savedAt})` : `저장 실패: ${data.error}`)
      if (data.success && onSave) onSave(clipData.sampleId)
    } catch (err) {
      setMessage(`오류: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }, [clipData?.sampleId, segments, onSave])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/dataset-builder/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: clipData.sampleId, segments }),
      })
      const data = await res.json()
      setMessage(data.success
        ? `export 완료: ${data.exported}개 승인, ${data.rejected}개 제외`
        : `export 실패: ${data.error}`
      )
    } catch (err) {
      setMessage(`오류: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }, [clipData?.sampleId, segments])

  const approvedCount = segments.filter(s => s.status === 'approved').length

  if (!clipData) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Clip header */}
      <div className="shrink-0 px-4 py-2 border-b border-white/10 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{clipData.newsTitle || clipData.sampleId}</div>
          <div className="text-xs text-gray-500 font-mono truncate">{clipData.sampleId}</div>
        </div>
        <div className="flex gap-3 text-xs text-gray-500 shrink-0">
          <span>{clipData.durationSec.toFixed(1)}s</span>
          <span>{clipData.frameCount}f</span>
          <span>{segments.length}개 구간</span>
          <span className="text-green-400">{approvedCount} 승인</span>
        </div>
      </div>

      {/* Audio + controls */}
      <div className="shrink-0 px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <audio ref={audioRef} src={clipData.audioUrl} preload="auto" />
        <button
          onClick={() => audioRef.current?.paused ? audioRef.current?.play() : audioRef.current?.pause()}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white"
        >
          {isPlaying ? '⏸ 일시정지' : '▶ 재생'}
        </button>
        <button
          onClick={handlePlaySegment}
          disabled={!selectedSeg}
          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded text-xs text-white"
        >
          ▶ 구간 재생
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-400">
          <input type="checkbox" checked={loopSeg} onChange={e => setLoopSeg(e.target.checked)} />
          루프
        </label>
        <span className="ml-auto text-xs text-gray-500 font-mono">{fmt(currentTime)}</span>
      </div>

      {/* Timeline */}
      <div className="shrink-0 px-4 py-2 border-b border-white/10">
        <SegmentTimeline
          duration={clipData.durationSec}
          jawOpen={clipData.jawOpen}
          jawOpenStep={clipData.jawOpenStep}
          segments={segments}
          selectedId={selectedId}
          currentTime={currentTime}
          onTimeClick={handleTimeClick}
          onSegmentSelect={handleSegmentSelect}
          onSegmentChange={handleSegmentChange}
        />
      </div>

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {segments.map((seg, idx) => {
          const st = STATUS_LABEL[seg.status] || STATUS_LABEL.draft
          const isSelected = seg.id === selectedId
          const duration = seg.endSec - seg.startSec
          const warn = duration < 1.0 || duration > 15
          return (
            <div
              key={seg.id}
              onClick={() => setSelectedId(seg.id)}
              className={`rounded p-2.5 cursor-pointer border transition-colors ${
                isSelected
                  ? 'bg-gray-700 border-blue-500'
                  : 'bg-gray-800 border-transparent hover:border-white/10'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-600 font-mono w-4 shrink-0 mt-0.5">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 leading-snug">{seg.text}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500 font-mono">
                      {fmt(seg.startSec)} → {fmt(seg.endSec)}
                    </span>
                    <span className={`text-xs font-medium ${warn ? 'text-yellow-400' : 'text-gray-600'}`}>
                      {duration.toFixed(1)}s
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                  </div>
                </div>
                {isSelected && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); handleSetStatus(seg.id, 'approved') }}
                      className="text-xs px-2 py-0.5 bg-green-700 hover:bg-green-600 rounded text-white"
                    >✓</button>
                    <button
                      onClick={e => { e.stopPropagation(); handleSetStatus(seg.id, 'rejected') }}
                      className="text-xs px-2 py-0.5 bg-red-800 hover:bg-red-700 rounded text-white"
                    >✕</button>
                  </div>
                )}
              </div>
              {/* Editable times (selected only) */}
              {isSelected && (
                <div className="flex gap-2 mt-2 pl-6" onClick={e => e.stopPropagation()}>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    시작
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max={seg.endSec - 0.1}
                      value={seg.startSec}
                      onChange={e => handleSegmentChange(seg.id, 'start', parseFloat(e.target.value))}
                      className="w-16 bg-gray-900 border border-white/10 rounded px-1 py-0.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    끝
                    <input
                      type="number"
                      step="0.1"
                      min={seg.startSec + 0.1}
                      max={clipData.durationSec}
                      value={seg.endSec}
                      onChange={e => handleSegmentChange(seg.id, 'end', parseFloat(e.target.value))}
                      className="w-16 bg-gray-900 border border-white/10 rounded px-1 py-0.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Action bar */}
      <div className="shrink-0 px-4 py-2 border-t border-white/10 flex items-center gap-2">
        {message && (
          <span className="text-xs text-gray-400 flex-1 truncate">{message}</span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs text-white"
          >
            {saving ? '저장 중…' : '작업 저장'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || approvedCount === 0}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded text-xs text-white"
          >
            {exporting ? 'export 중…' : `Export (${approvedCount}개 승인)`}
          </button>
        </div>
      </div>
    </div>
  )
}
