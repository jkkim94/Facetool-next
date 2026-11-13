'use client'

import { useEffect, useState } from 'react'
import FaceCreatorViewer from '@/components/FaceCreatorViewer'
import { useDnaProfiles } from '@/lib/useDnaProfiles'

export default function FaceCreatorView() {
  const [serverBase, setServerBase] = useState('http://localhost:8765')
  const [error, setError] = useState(null)

  useEffect(() => {
    setServerBase(`http://${window.location.hostname}:8765`)
  }, [])

  const {
    dnaProfiles,
    dnaProfileId,
    dnaSwitching,
    switchDnaProfile,
  } = useDnaProfiles(serverBase)

  const onDnaChange = async (nextId) => {
    setError(null)
    try {
      await switchDnaProfile(nextId)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-900 text-gray-100">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="text-sm font-semibold whitespace-nowrap">얼굴 편집</span>
        <span className="hidden text-[11px] text-gray-500 sm:inline">
          부위별 얼굴 만들기 · 피부색 · 표정
        </span>
        {dnaProfiles.length > 0 && (
          <select
            value={dnaProfileId}
            onChange={(e) => onDnaChange(e.target.value)}
            disabled={dnaSwitching || !dnaProfileId}
            className="max-w-[240px] rounded border border-white/10 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 disabled:opacity-50"
            title="MetaHuman DNA 프로필"
          >
            {dnaProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {dnaSwitching && (
          <span className="animate-pulse text-sm text-yellow-300">DNA 전환 중…</span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
        <span className="ml-auto text-[11px] text-gray-500">
          serve.py :8765
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {dnaProfileId ? (
          <FaceCreatorViewer
            key={`face-creator-${dnaProfileId}`}
            serverBase={serverBase}
            dnaProfileId={dnaProfileId}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            serve.py(8765) 연결 중…
          </div>
        )}
      </div>
    </div>
  )
}
