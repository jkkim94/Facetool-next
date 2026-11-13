'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  REGION_HOTSPOT,
  REGION_META,
  REGION_OVERVIEW_ORDER,
  compactControlLabel,
  countControlsByRegion,
  parseAxis,
} from '../lib/faceBoardLayout'

const SIDE_STYLE = {
  L: 'bg-blue-500/20 text-blue-200 border-blue-400/40',
  R: 'bg-orange-500/20 text-orange-200 border-orange-400/40',
  C: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
}

function FaceSilhouette() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="fb-bg" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="#2a3140" />
          <stop offset="100%" stopColor="#0e1016" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#fb-bg)" />
      <ellipse cx="50" cy="42" rx="28" ry="34" fill="none" stroke="#3d4658" strokeWidth="0.6" />
      <ellipse cx="38" cy="32" rx="5" ry="3" fill="none" stroke="#4a5568" strokeWidth="0.35" />
      <ellipse cx="62" cy="32" rx="5" ry="3" fill="none" stroke="#4a5568" strokeWidth="0.35" />
      <path d="M 50 38 L 47 48 L 50 46 L 53 48 Z" fill="none" stroke="#4a5568" strokeWidth="0.35" />
      <path d="M 40 54 Q 50 58 60 54" fill="none" stroke="#4a5568" strokeWidth="0.4" />
      <path d="M 38 72 Q 50 78 62 72 L 58 92 Q 50 96 42 92 Z" fill="none" stroke="#3d4658" strokeWidth="0.5" />
    </svg>
  )
}

function ControlRow({
  control,
  selected,
  value,
  onSelect,
  onDragStart,
}) {
  const { side, axis, core, full } = compactControlLabel(control.name)
  const axisLabel = axis === 'tx' ? '↔ 좌우' : '↕ 상하'

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        selected
          ? 'border-cyan-400/60 bg-cyan-500/10 ring-1 ring-cyan-400/30'
          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(control.index)}
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SIDE_STYLE[side] || SIDE_STYLE.C}`}
        title={control.name}
      >
        {side}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-gray-100" title={full}>
          {core}
        </div>
        <div className="text-[9px] text-gray-500">{axisLabel}</div>
      </div>
      <div
        className={`shrink-0 touch-none rounded border border-white/20 bg-black/30 ${
          axis === 'tx' ? 'h-7 w-16 cursor-ew-resize' : 'h-14 w-7 cursor-ns-resize'
        }`}
        title={`${full} — 드래그 조절`}
        onPointerDown={(e) => onDragStart(control, e)}
      />
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-gray-300">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

/**
 * @param {{
 *   controls: { index: number, name: string, region: string, min: number, max: number }[],
 *   valuesRef: React.MutableRefObject<number[]|null>,
 *   valueTick?: number,
 *   selectedControls: number[],
 *   resetTick: number,
 *   onControlChange: (index: number, value: number) => void,
 *   onSelect: (index: number) => void,
 * }} props
 */
export default function FaceBoardPanel({
  controls,
  valuesRef,
  valueTick = 0,
  selectedControls,
  resetTick,
  onControlChange,
  onSelect,
}) {
  const dragRef = useRef(null)
  const [activeRegion, setActiveRegion] = useState(null)
  const [search, setSearch] = useState('')

  const selectedSet = useMemo(() => new Set(selectedControls), [selectedControls])
  const regionCounts = useMemo(() => countControlsByRegion(controls), [controls])

  const regionControls = useMemo(() => {
    if (!activeRegion) return []
    return controls
      .filter((c) => (REGION_META[c.region] ? c.region : 'other') === activeRegion)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [controls, activeRegion])

  const filteredControls = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return regionControls
    return regionControls.filter((c) => {
      const { core, full } = compactControlLabel(c.name)
      return core.toLowerCase().includes(q) || full.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    })
  }, [regionControls, search])

  const valueOf = useCallback(
    (index) => valuesRef.current?.[index] ?? 0,
    [valueTick, valuesRef],
  )

  const onDragStart = (control, e) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(control.index)
    const axis = parseAxis(control.name)
    dragRef.current = {
      index: control.index,
      axis,
      min: control.min,
      max: control.max,
      startVal: valueOf(control.index),
      startX: e.clientX,
      startY: e.clientY,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const delta = d.axis === 'tx' ? dx / 100 : -dy / 100
    const range = d.max - d.min
    let v = d.startVal + delta * range
    v = Math.max(d.min, Math.min(d.max, v))
    onControlChange(d.index, Math.round(v * 100) / 100)
  }

  const onPointerUp = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  const openRegion = (region) => {
    setActiveRegion(region)
    setSearch('')
  }

  const meta = activeRegion ? REGION_META[activeRegion] : null

  return (
    <div className="flex h-full min-h-0 flex-col rounded border border-white/10 bg-[#12151c] overflow-hidden select-none">
      {!activeRegion ? (
        <>
          <div className="shrink-0 border-b border-white/10 px-3 py-2">
            <p className="text-xs text-gray-200">부위를 선택하세요</p>
            <p className="text-[10px] text-gray-500">174개 컨트롤 · 이름이 보이는 목록으로 조절</p>
          </div>
          <div className="relative min-h-0 flex-1">
            <FaceSilhouette />
            {REGION_OVERVIEW_ORDER.map((region) => {
              const count = regionCounts[region] || 0
              if (!count) return null
              const spot = REGION_HOTSPOT[region]
              const m = REGION_META[region]
              return (
                <button
                  key={region}
                  type="button"
                  onClick={() => openRegion(region)}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-1 text-left shadow-lg transition hover:scale-105 hover:brightness-110"
                  style={{
                    left: `${spot.x * 100}%`,
                    top: `${spot.y * 100}%`,
                    borderColor: `${m.color}88`,
                    background: `${m.color}22`,
                  }}
                >
                  <div className="text-[11px] font-semibold text-gray-100">{m.label}</div>
                  <div className="text-[9px] text-gray-400">{count}개 · {m.labelEn}</div>
                </button>
              )
            })}
          </div>
          <div className="shrink-0 border-t border-white/10 px-3 py-2 text-[9px] text-gray-500">
            L=왼쪽 · R=오른쪽 · C=중앙 · ↔ tx(좌우) · ↕ ty(상하)
          </div>
        </>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
            <button
              type="button"
              onClick={() => setActiveRegion(null)}
              className="rounded bg-white/10 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/20"
            >
              ← 부위
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: meta.color }}
                />
                <span className="text-sm font-semibold text-gray-100">{meta.label}</span>
                <span className="text-[10px] text-gray-500">{regionControls.length} controls</span>
              </div>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 검색…"
              className="w-32 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-gray-200 placeholder:text-gray-600"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            {filteredControls.map((c) => (
              <ControlRow
                key={`${c.index}-${resetTick}`}
                control={c}
                selected={selectedSet.has(c.index)}
                value={valueOf(c.index)}
                onSelect={onSelect}
                onDragStart={onDragStart}
              />
            ))}
            {filteredControls.length === 0 && (
              <p className="py-8 text-center text-xs text-gray-500">검색 결과 없음</p>
            )}
          </div>
          <div className="shrink-0 border-t border-white/10 px-3 py-2 text-[9px] text-gray-500">
            이름 클릭=선택 · 작은 박스 드래그=값 조절 · 슬라이더는 하단 패널
          </div>
        </>
      )}
    </div>
  )
}
