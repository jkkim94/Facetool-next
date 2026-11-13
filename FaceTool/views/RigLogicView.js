'use client'

import { useCallback, useEffect, useState } from 'react'
import RigLogicViewer from '@/components/RigLogicViewer'
import RigLogicLiveViewer from '@/components/RigLogicLiveViewer'
import RigLogicGuiViewer from '@/components/RigLogicGuiViewer'
import { useDnaProfiles } from '@/lib/useDnaProfiles'

export default function RigLogicView() {
  const [mode, setMode] = useState('gui') // 'live' | 'bake' | 'gui'
  const [clips, setClips] = useState([])
  const [selected, setSelected] = useState(null)
  const [bakedSet, setBakedSet] = useState(() => new Set())
  const [baking, setBaking] = useState(false)
  const [error, setError] = useState(null)
  const [serverBase, setServerBase] = useState('http://localhost:8765')

  useEffect(() => {
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [])

  const {
    dnaProfiles,
    dnaProfileId,
    dnaSwitching,
    switchDnaProfile,
  } = useDnaProfiles(serverBase)

  const refresh = useCallback(async (profileId) => {
    if (!profileId) return []
    try {
      const q = `list=1&dna=${encodeURIComponent(profileId)}`
      const d = await fetch(`/api/riglogic?${q}`).then((r) => r.json())
      const list = d.clips || []
      setClips(list)
      setBakedSet(new Set(list.filter((c) => c.baked).map((c) => c.id)))
      return list
    } catch (e) {
      setError(e.message)
      return []
    }
  }, [])

  useEffect(() => {
    if (!dnaProfileId) return
    refresh(dnaProfileId).then((list) => {
      if (list.length === 0) return
      const firstBaked = list.find((c) => c.baked)
      setSelected((firstBaked || list[0]).id)
    })
  }, [refresh, dnaProfileId])

  // ensure selected clip is baked (on-demand bake if needed) — bake mode only
  useEffect(() => {
    if (mode !== 'bake') return
    if (!selected || !dnaProfileId) return
    if (bakedSet.has(selected)) return
    let cancelled = false
    setBaking(true)
    setError(null)
    fetch('/api/riglogic/bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip: selected, dnaProfile: dnaProfileId }),
    })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'bake 실패')
        return j
      })
      .then(() => {
        if (cancelled) return
        setBakedSet((prev) => new Set(prev).add(selected))
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setBaking(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, selected, bakedSet, dnaProfileId])

  const ready = selected && bakedSet.has(selected)

  const onDnaChange = async (nextId) => {
    setError(null)
    try {
      await switchDnaProfile(nextId)
    } catch (e) {
      setError(e.message)
    }
  }

  const viewerBusy = baking || dnaSwitching

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
        <span className="text-sm font-semibold whitespace-nowrap">RigLogic 재생</span>
        <div className="flex rounded overflow-hidden border border-white/15">
          <button
            type="button"
            onClick={() => setMode('live')}
            className={`px-3 py-1.5 text-xs ${mode === 'live' ? 'bg-emerald-600 text-white' : 'bg-white/5 text-gray-300'}`}
          >
            라이브 (베이크 없음)
          </button>
          <button
            type="button"
            onClick={() => setMode('bake')}
            className={`px-3 py-1.5 text-xs ${mode === 'bake' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300'}`}
          >
            베이크
          </button>
          <button
            type="button"
            onClick={() => setMode('gui')}
            className={`px-3 py-1.5 text-xs ${mode === 'gui' ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-300'}`}
          >
            GUI 조작
          </button>
        </div>
        {dnaProfiles.length > 1 && (
          <select
            value={dnaProfileId}
            onChange={(e) => onDnaChange(e.target.value)}
            disabled={viewerBusy || !dnaProfileId}
            className="max-w-[220px] rounded border border-white/10 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 disabled:opacity-50"
            title="head DNA 프로필"
          >
            {dnaProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {mode !== 'gui' && (
          <select
            value={selected || ''}
            onChange={(e) => setSelected(e.target.value)}
            disabled={viewerBusy}
            className="bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm max-w-[420px] disabled:opacity-50"
          >
            {clips.length === 0 && <option value="">클립 없음</option>}
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {mode === 'bake' ? (bakedSet.has(c.id) ? '● ' : '○ ') : ''}
                {c.id}
              </option>
            ))}
          </select>
        )}
        {dnaSwitching && (
          <span className="text-yellow-300 text-sm animate-pulse">DNA 전환 중…</span>
        )}
        {baking && (
          <span className="text-yellow-300 text-sm animate-pulse">베이크 중… (최초 1회, 약 20~30초)</span>
        )}
        {error && <span className="text-red-400 text-sm">{error}</span>}
        <span className="ml-auto text-xs text-gray-500">
          {mode === 'gui'
            ? 'DNA MetaHuman · Face Board + GUI 컨트롤 실시간 조작 (베이크 없음)'
            : 'DNA MetaHuman · 컨트롤(NPY) 기반 정점 재생 + 텍스처 + 오디오 동기'}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {mode === 'gui' ? (
          dnaProfileId ? (
            <RigLogicGuiViewer
              key={`gui-${dnaProfileId}`}
              serverBase={serverBase}
              dnaProfileId={dnaProfileId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              serve.py(8765) 연결 중…
            </div>
          )
        ) : mode === 'live' ? (
          selected && dnaProfileId ? (
            <RigLogicLiveViewer
              key={`live-${dnaProfileId}-${selected}`}
              clip={selected}
              serverBase={serverBase}
              dnaProfileId={dnaProfileId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              {dnaProfileId ? '클립을 선택하세요.' : 'serve.py(8765) 연결 중…'}
            </div>
          )
        ) : ready && dnaProfileId ? (
          <RigLogicViewer
            key={`bake-${dnaProfileId}-${selected}`}
            clip={selected}
            dnaProfileId={dnaProfileId}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {baking
              ? `"${selected}" 베이크 중입니다…`
              : selected
                ? '준비 중…'
                : '베이크할 클립을 선택하세요.'}
          </div>
        )}
      </div>
    </div>
  )
}
