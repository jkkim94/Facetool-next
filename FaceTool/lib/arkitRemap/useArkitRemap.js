'use client'

import { useCallback, useEffect, useState } from 'react'
import { remapMetaHumanToArkitGlb } from '@/lib/arkitRemap/arkitRemap'

/**
 * MetaHuman training data → ARKit GLB (FaceTool eval 탭용)
 */
export function useArkitRemapPayload() {
  const [payload, setPayload] = useState(null)
  const [payloadPath, setPayloadPath] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/arkit-remap/payload')
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Payload 로드 실패')
      }
      setPayload(json.payload)
      setPayloadPath(json.path ?? null)
    } catch (e) {
      setPayload(null)
      setPayloadPath(null)
      setError(e instanceof Error ? e.message : 'Payload 로드 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { payload, payloadPath, loading, error, reload }
}

export function applyArkitRemap(trainingData, payload, options = {}) {
  if (!trainingData || !payload) return null
  if (trainingData.outputKind === 'arkit_51') return trainingData
  if (trainingData.outputKind !== 'metahuman_260') return null
  try {
    return remapMetaHumanToArkitGlb(trainingData, payload, options)
  } catch (e) {
    console.error('[ARKit Remap]', e)
    return null
  }
}

/** 뷰어 모드 기준 비교용 output kind (GLB+Remap이면 MH도 arkit_51로 통일) */
export function effectiveCompareKind(data, runKind, useGlbViewer) {
  if (!data?.outputKind) return null
  if (runKind === 'metahuman_260' && useGlbViewer) return 'arkit_51'
  return data.outputKind
}
