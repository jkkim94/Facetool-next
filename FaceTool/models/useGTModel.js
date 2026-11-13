/**
 * ============================================================================
 * Model: GT (Ground Truth) 데이터 상태 관리
 * ============================================================================
 */

import { useState } from 'react'

export function useGTModel() {
  const [gtData, setGTData] = useState(null)
  const [gtLoading, setGTLoading] = useState(false)
  const [gtError, setGTError] = useState(null)

  const reset = () => {
    setGTData(null)
    setGTError(null)
  }

  return {
    gtData,
    gtLoading,
    gtError,
    setGTData,
    setGTLoading,
    setGTError,
    reset
  }
}
