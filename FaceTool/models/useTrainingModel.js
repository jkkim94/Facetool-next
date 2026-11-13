/**
 * ============================================================================
 * Model: 학습 결과 상태 관리
 * ============================================================================
 */

import { useState } from 'react'

export function useTrainingModel() {
  const [trainingData, setTrainingData] = useState(null)
  const [trainingLoading, setTrainingLoading] = useState(false)
  const [trainingError, setTrainingError] = useState(null)
  // LVE/LVD 메트릭 상태
  const [metrics, setMetrics] = useState(null)

  const reset = () => {
    setTrainingData(null)
    setTrainingError(null)
    setMetrics(null)
  }

  return {
    trainingData,
    trainingLoading,
    trainingError,
    metrics,
    setTrainingData,
    setTrainingLoading,
    setTrainingError,
    setMetrics,
    reset
  }
}

