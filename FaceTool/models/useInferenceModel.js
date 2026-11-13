/**
 * ============================================================================
 * Model: 추론 상태 관리
 * ============================================================================
 * 
 * 두 서비스(EmoTalk, UniTalker D4)의 추론 데이터와 상태를 관리합니다.
 * (SAiD는 제거됨)
 * (SAiD는 제거됨)
 * ============================================================================
 */

import { useState } from 'react'

export function useInferenceModel() {
  // EmoTalk 상태
  const [emotalkData, setEmotalkData] = useState(null)
  const [emotalkLoading, setEmotalkLoading] = useState(false)
  const [emotalkError, setEmotalkError] = useState(null)

  // UniTalker D4 상태
  const [unitalkerD4Data, setUnitalkerD4Data] = useState(null)
  const [unitalkerD4Loading, setUnitalkerD4Loading] = useState(false)
  const [unitalkerD4Error, setUnitalkerD4Error] = useState(null)

  // 상태 초기화
  const resetEmotalk = () => {
    setEmotalkData(null)
    setEmotalkError(null)
  }

  const resetUnitalkerD4 = () => {
    setUnitalkerD4Data(null)
    setUnitalkerD4Error(null)
  }

  const resetAll = () => {
    resetEmotalk()
    resetUnitalkerD4()
  }

  return {
    // EmoTalk 상태
    emotalkData,
    emotalkLoading,
    emotalkError,
    setEmotalkData,
    setEmotalkLoading,
    setEmotalkError,
    resetEmotalk,

    // UniTalker D4 상태
    unitalkerD4Data,
    unitalkerD4Loading,
    unitalkerD4Error,
    setUnitalkerD4Data,
    setUnitalkerD4Loading,
    setUnitalkerD4Error,
    resetUnitalkerD4,

    // 전체 초기화
    resetAll
  }
}

