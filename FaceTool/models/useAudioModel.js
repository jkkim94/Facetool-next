/**
 * ============================================================================
 * Model: 오디오 상태 관리 + 프레임 기반 재생
 * ============================================================================
 * 
 * DataValid 방식: 프레임 기반으로 정확한 프레임 번호 보장
 * - setInterval로 프레임 카운트
 * - 오디오가 프레임을 따라감 (프레임 -> 오디오 동기화)
 * ============================================================================
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'

export function useAudioModel() {
  const [audioFile, setAudioFile] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [fps, setFps] = useState(30)
  
  const audioRef = useRef(null)
  const previousUrlRef = useRef(null)
  const playbackIntervalRef = useRef(null)

  const audioUrl = useMemo(() => {
    if (audioFile) {
      return URL.createObjectURL(audioFile)
    }
    return null
  }, [audioFile])
  
  // 이전 URL 메모리 해제
  useEffect(() => {
    if (previousUrlRef.current && previousUrlRef.current !== audioUrl) {
      URL.revokeObjectURL(previousUrlRef.current)
    }
    previousUrlRef.current = audioUrl
    
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  // 프레임 기반 재생 로직 (DataValid 방식)
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
      // 오디오 일시정지
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause()
      }
      return
    }
    
    // 오디오 재생 시작 (현재 프레임 위치로 동기화)
    if (audioRef.current) {
      const audioTime = Math.max(0, currentFrame / fps)
      audioRef.current.currentTime = audioTime
      audioRef.current.playbackRate = playbackRate
      audioRef.current.play().catch(e => console.log('Audio play failed:', e))
    }
    
    const frameInterval = (1000 / fps) / playbackRate
    
    playbackIntervalRef.current = setInterval(() => {
      setCurrentFrame(prev => {
        const nextFrame = prev + 1
        if (nextFrame >= totalFrames) {
          setIsPlaying(false)
          if (audioRef.current) audioRef.current.pause()
          return prev
        }
        
        // 오디오 동기화 (프레임 -> 오디오)
        // 드리프트 보정: 오디오 시간이 프레임과 0.1초 이상 차이나면 보정
        if (audioRef.current && !audioRef.current.paused) {
          const expectedAudioTime = nextFrame / fps
          const actualAudioTime = audioRef.current.currentTime
          const drift = Math.abs(expectedAudioTime - actualAudioTime)
          
          if (drift > 0.1) {
            audioRef.current.currentTime = expectedAudioTime
          }
        }
        
        return nextFrame
      })
    }, frameInterval)
    
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }
  }, [isPlaying, fps, playbackRate, totalFrames])

  // 재생속도 변경 시 interval 재설정
  useEffect(() => {
    if (isPlaying && playbackIntervalRef.current) {
      // interval 재설정을 위해 isPlaying 토글
      setIsPlaying(false)
      setTimeout(() => setIsPlaying(true), 10)
    }
    
    // 오디오 재생속도도 업데이트
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  const reset = useCallback(() => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current)
      playbackIntervalRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setCurrentFrame(0)
  }, [])

  // 특정 프레임으로 이동
  const seekToFrame = useCallback((frame) => {
    const clampedFrame = Math.max(0, Math.min(totalFrames - 1, frame))
    setCurrentFrame(clampedFrame)
    
    // 오디오도 해당 위치로 이동
    if (audioRef.current) {
      audioRef.current.currentTime = clampedFrame / fps
    }
  }, [totalFrames, fps])

  return {
    audioFile,
    setAudioFile,
    isPlaying,
    setIsPlaying,
    playbackRate,
    setPlaybackRate,
    audioRef,
    audioUrl,
    reset,
    // 프레임 관련 추가
    currentFrame,
    setCurrentFrame,
    totalFrames,
    setTotalFrames,
    fps,
    setFps,
    seekToFrame
  }
}

