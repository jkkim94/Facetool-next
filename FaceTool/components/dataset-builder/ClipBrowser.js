'use client'

import { useState, useMemo } from 'react'

const STATUS_LABEL = {
  unset: { label: '미시작', dot: 'bg-gray-500' },
  in_progress: { label: '진행 중', dot: 'bg-yellow-400' },
  done: { label: '완료', dot: 'bg-green-400' },
  error: { label: '오류', dot: 'bg-red-500' },
}

const FILTERS = ['전체', '미시작', '진행 중', '완료', '오류']
const FILTER_MAP = { '전체': null, '미시작': 'unset', '진행 중': 'in_progress', '완료': 'done', '오류': 'error' }

export default function ClipBrowser({ clips, selectedId, onSelect }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('전체')

  const filtered = useMemo(() => {
    let list = clips
    const statusFilter = FILTER_MAP[filter]
    if (statusFilter) list = list.filter(c => c.workspaceStatus === statusFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(c =>
        c.sampleId.toLowerCase().includes(q) ||
        c.newsTitle.toLowerCase().includes(q)
      )
    }
    return list
  }, [clips, query, filter])

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-white/10 w-72 shrink-0">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="text-xs font-semibold text-gray-400 uppercase mb-2">
          클립 브라우저 ({clips.length})
        </div>
        <input
          type="text"
          placeholder="검색..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-gray-800 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 px-3 pb-2 shrink-0">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              filter === f
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Clip list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-8">결과 없음</div>
        )}
        {filtered.map(clip => {
          const st = STATUS_LABEL[clip.workspaceStatus] || STATUS_LABEL.unset
          const isSelected = clip.sampleId === selectedId
          return (
            <button
              key={clip.sampleId}
              onClick={() => onSelect(clip.sampleId)}
              className={`w-full text-left px-3 py-2.5 border-b border-white/5 transition-colors hover:bg-white/5 ${
                isSelected ? 'bg-blue-900/40 border-l-2 border-l-blue-500' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                <span className="text-xs text-gray-300 font-mono truncate">
                  {clip.sampleId.replace(/^s\d{4}_/, '')}
                </span>
              </div>
              {clip.newsTitle && (
                <div className="text-xs text-gray-500 truncate pl-3 mb-0.5">{clip.newsTitle}</div>
              )}
              <div className="flex gap-2 pl-3">
                <span className="text-xs text-gray-600">{clip.durationSec}s</span>
                {!clip.isPreset && (
                  <span className="text-xs text-gray-600">{clip.sentenceCount}문장</span>
                )}
                {clip.totalSegments > 0 && (
                  <span className="text-xs text-blue-400">
                    {clip.approvedCount}/{clip.totalSegments} ✓
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
