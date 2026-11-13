'use client'

import { useRef, useEffect, useCallback, useState } from 'react'

const STATUS_COLORS = {
  draft: '#4b5563',
  auto_aligned: '#2563eb',
  manual_edited: '#7c3aed',
  review_required: '#d97706',
  approved: '#16a34a',
  rejected: '#dc2626',
}

export default function SegmentTimeline({
  duration,
  jawOpen,
  jawOpenStep,
  segments,
  selectedId,
  currentTime,
  onTimeClick,
  onSegmentSelect,
  onSegmentChange,
}) {
  const containerRef = useRef(null)
  const waveCanvasRef = useRef(null)
  const jawCanvasRef = useRef(null)
  const [dragging, setDragging] = useState(null)

  // Draw jawOpen graph
  useEffect(() => {
    const canvas = jawCanvasRef.current
    if (!canvas || !jawOpen?.length || !duration) return
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    for (let i = 0; i < jawOpen.length; i++) {
      const x = (i / jawOpen.length) * W
      const y = H - jawOpen[i] * H
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }, [jawOpen, duration])

  const timeToPercent = useCallback(t => (duration > 0 ? (t / duration) * 100 : 0), [duration])
  const percentToTime = useCallback(px => (duration > 0 ? px * duration : 0), [duration])

  // Drag logic
  const handleMouseDown = useCallback((e, segId, edge) => {
    e.stopPropagation()
    e.preventDefault()
    const seg = segments.find(s => s.id === segId)
    if (!seg) return
    setDragging({
      segId,
      edge,
      startX: e.clientX,
      initTime: edge === 'start' ? seg.startSec : seg.endSec,
    })
    onSegmentSelect(segId)
  }, [segments, onSegmentSelect])

  useEffect(() => {
    if (!dragging) return
    const onMove = e => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const dt = ((e.clientX - dragging.startX) / rect.width) * duration
      let newTime = Math.max(0, Math.min(duration, dragging.initTime + dt))
      // Snap to nearest 0.1s
      newTime = Math.round(newTime * 10) / 10
      onSegmentChange(dragging.segId, dragging.edge, newTime)
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, duration, onSegmentChange])

  const handleTimelineClick = useCallback(e => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const pct = (e.clientX - rect.left) / rect.width
    onTimeClick(percentToTime(pct))
  }, [percentToTime, onTimeClick])

  // Generate time ruler ticks
  const ticks = []
  if (duration > 0) {
    const interval = duration > 60 ? 10 : duration > 20 ? 5 : 2
    for (let t = 0; t <= duration; t += interval) {
      ticks.push(t)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height: 120 }}
      onClick={handleTimelineClick}
    >
      {/* Time ruler */}
      <div className="absolute top-0 left-0 right-0 h-5 pointer-events-none">
        {ticks.map(t => (
          <div
            key={t}
            className="absolute flex flex-col items-center"
            style={{ left: timeToPercent(t) + '%', transform: 'translateX(-50%)' }}
          >
            <div className="w-px h-2 bg-white/20" />
            <span className="text-gray-500 text-xs" style={{ fontSize: 9 }}>{t}s</span>
          </div>
        ))}
      </div>

      {/* jawOpen canvas */}
      <canvas
        ref={jawCanvasRef}
        className="absolute left-0 right-0 pointer-events-none"
        style={{ top: 20, bottom: 40, width: '100%', height: 60 }}
      />

      {/* Segments */}
      <div className="absolute left-0 right-0 pointer-events-none" style={{ top: 80, height: 36 }}>
        {segments.map(seg => {
          const left = timeToPercent(seg.startSec)
          const width = timeToPercent(seg.endSec) - timeToPercent(seg.startSec)
          const isSelected = seg.id === selectedId
          const color = STATUS_COLORS[seg.status] || STATUS_COLORS.draft
          return (
            <div
              key={seg.id}
              className="absolute top-0 bottom-0 rounded overflow-visible"
              style={{
                left: left + '%',
                width: Math.max(width, 0.3) + '%',
                background: color,
                opacity: isSelected ? 1 : 0.65,
                border: isSelected ? '1px solid white' : '1px solid transparent',
                pointerEvents: 'all',
              }}
              onClick={e => { e.stopPropagation(); onSegmentSelect(seg.id) }}
            >
              {/* Left handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                style={{ background: 'rgba(255,255,255,0.3)', pointerEvents: 'all' }}
                onMouseDown={e => handleMouseDown(e, seg.id, 'start')}
              />
              {/* Label */}
              {width > 4 && (
                <span className="absolute inset-0 flex items-center justify-center text-white font-medium pointer-events-none" style={{ fontSize: 10 }}>
                  {seg.sentenceIndex + 1}
                </span>
              )}
              {/* Right handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                style={{ background: 'rgba(255,255,255,0.3)', pointerEvents: 'all' }}
                onMouseDown={e => handleMouseDown(e, seg.id, 'end')}
              />
            </div>
          )
        })}
      </div>

      {/* Playhead */}
      {currentTime > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none"
          style={{ left: timeToPercent(currentTime) + '%', zIndex: 10 }}
        />
      )}

      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gray-900 rounded" />
    </div>
  )
}
