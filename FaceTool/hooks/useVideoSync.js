/**
 * 비디오, CSV, 3D 애니메이션 동기화 로직
 * 
 * 이 파일은 비디오 재생, CSV 프레임 매칭, 3D 모델 애니메이션을
 * 프레임 단위로 정확하게 동기화하는 모든 로직을 포함합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import timingLogger from '@/lib/timingLogger';

/**
 * 비디오 동기화 Hook
 * 
 * @param {Object} params
 * @param {Object} params.blendshapeData - CSV에서 파싱된 블렌드쉐입 데이터
 * @param {number} params.fps - 비디오 FPS
 * @param {number} params.videoDuration - 비디오 총 길이 (초)
 * @param {React.RefObject} params.videoRef - 비디오 엘리먼트 ref
 * @param {number} params.playbackRate - 재생 속도 (0.1 ~ 1.0)
 * 
 * @returns {Object} 동기화 상태 및 제어 함수들
 */
export function useVideoSync({
  blendshapeData,
  fps,
  videoDuration,
  videoRef,
  playbackRate = 1.0,
}) {
  // ========== 상태 ==========
  const [currentFrame, setCurrentFrame] = useState(0); // CSV 프레임 번호 (0-based)
  const [currentTime, setCurrentTime] = useState(0); // 비디오 시간 (초)
  const [isPlaying, setIsPlaying] = useState(false); // 재생 중 여부
  const [videoFrameNumber, setVideoFrameNumber] = useState(0); // 비디오 프레임 번호 (표시용, 0-based)
  const [latency, setLatency] = useState(0); // 실제 latency (ms)

  // ========== Refs ==========
  const currentFrameRef = useRef(0); // 현재 프레임 번호 (ref로 즉시 접근)
  const currentTimeRef = useRef(0); // 현재 비디오 시간 (ref로 즉시 접근)
  const playbackIntervalRef = useRef(null); // 정밀 재생 모드용 setInterval
  const lastFrameUpdateTimeRef = useRef(0); // 마지막 프레임 업데이트 시간
  const isSeekingRef = useRef(false); // 시크 진행 중 플래그
  const seekedTimeRef = useRef(null); // 시크한 시간 저장 (시크 완료 후 handleTimeUpdate 무시용)

  // ========== 유틸리티 함수 ==========

  /**
   * CSV에서 프레임 데이터 가져오기
   * @param {number} frameNum - 프레임 번호 (0-based)
   * @returns {Object|null} 프레임 데이터
   */
  const getFrameData = useCallback((frameNum) => {
    if (!blendshapeData) return null;
    
    if (blendshapeData.framesMap) {
      return blendshapeData.framesMap[frameNum] || null;
    }
    return blendshapeData.frames[frameNum] || null;
  }, [blendshapeData]);

  /**
   * 비디오 시간에서 가장 가까운 CSV 프레임 찾기
   * @param {number} time - 비디오 시간 (초)
   * @returns {number} 가장 가까운 프레임 번호 (0-based)
   */
  const findClosestFrame = useCallback((time) => {
    if (!blendshapeData) return 0;
    
    let closestFrame = currentFrameRef.current;
    let minTimeDiff = Infinity;
    
    if (blendshapeData.framesMap) {
      // framesMap을 사용하여 가장 가까운 프레임 찾기
      for (const [frameNum, frameData] of Object.entries(blendshapeData.framesMap)) {
        const frameTime = frameData.time !== undefined 
          ? frameData.time 
          : (parseInt(frameNum) / fps);
        const timeDiff = Math.abs(time - frameTime);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestFrame = parseInt(frameNum);
        }
      }
    } else {
      // 배열을 사용하는 경우 (기존 호환성)
      const frame = Math.floor(time * fps);
      closestFrame = Math.min(Math.max(0, frame), blendshapeData.totalFrames - 1);
    }
    
    return closestFrame;
  }, [blendshapeData, fps]);

  /**
   * 비디오 시크 수행
   * @param {number} time - 시크할 시간 (초)
   * @param {boolean} isPreciseMode - 정밀 재생 모드 여부 (정밀 모드에서는 비디오를 일시정지하지 않음)
   */
  const seekVideo = useCallback((time, isPreciseMode = false) => {
    if (!videoRef?.current) return;
    
    const video = videoRef.current;
    const timeDiff = Math.abs(video.currentTime - time);
    
    // 1프레임 이상 차이나면 시크 수행
    if (timeDiff > 0.016) {
      isSeekingRef.current = true;
      seekedTimeRef.current = time;
      
      // 정밀 재생 모드가 아닐 때만 비디오를 일시정지 (정밀 모드에서는 이미 일시정지 상태)
      if (!isPreciseMode) {
        const wasPlaying = !video.paused;
        if (wasPlaying) {
          video.pause();
        }
      }
      
      video.currentTime = time;
      
      // 시크 완료 이벤트 리스너
      const handleSeeked = () => {
        isSeekingRef.current = false;
        setTimeout(() => {
          seekedTimeRef.current = null;
        }, 50);
        video.removeEventListener('seeked', handleSeeked);
      };
      
      video.addEventListener('seeked', handleSeeked, { once: true });
      
      // 타임아웃 안전장치
      setTimeout(() => {
        if (isSeekingRef.current) {
          isSeekingRef.current = false;
          seekedTimeRef.current = null;
        }
      }, 100);
    } else {
      // 시간 차이가 작으면 시크하지 않고 플래그만 해제
      isSeekingRef.current = false;
      seekedTimeRef.current = null;
    }
  }, [videoRef]);

  /**
   * 프레임과 시간 업데이트
   * @param {number} frameNum - CSV 프레임 번호 (0-based)
   * @param {number} time - 비디오 시간 (초)
   * @param {boolean} shouldSeekVideo - 비디오 시크 여부
   * @param {string} source - 업데이트 소스 ('playback', 'prev', 'next', 'seek', 'timeupdate')
   */
  const updateFrameAndTime = useCallback((frameNum, time, shouldSeekVideo = true, source = 'unknown') => {
    // Ref 업데이트 (즉시 반영)
    const oldFrame = currentFrameRef.current;
    const oldTime = currentTimeRef.current;
    currentFrameRef.current = frameNum;
    currentTimeRef.current = time;
    
    // State 업데이트 (UI 반영)
    setCurrentFrame(frameNum);
    setCurrentTime(time);
    
    // 비디오 프레임 번호 계산 (표시용)
    const videoFrame = Math.floor(time * fps);
    setVideoFrameNumber(videoFrame);
    
    // 상세 로그 출력
    const logData = {
      source,
      csvFrame: frameNum,
      csvFrameDisplay: frameNum + 1, // 1-based 표시용
      videoTime: time.toFixed(6),
      videoFrame: videoFrame,
      videoFrameDisplay: videoFrame + 1, // 1-based 표시용
      willSeek: shouldSeekVideo,
      oldFrame,
      oldTime: oldTime.toFixed(6),
      frameDelta: frameNum - oldFrame,
      timeDelta: (time - oldTime).toFixed(6),
      timestamp: new Date().toISOString(),
    };
    
    console.log(`[동기화 ${source}]`, logData);
    
    // 비디오 시크 (정밀 재생 모드 여부 전달)
    if (shouldSeekVideo) {
      const isPreciseMode = source === 'playback' && isPlaying && playbackIntervalRef.current;
      seekVideo(time, isPreciseMode);
    }
    
    // 타이밍 로거에 기록
    timingLogger.logVideoFrame(time, frameNum);
  }, [fps, seekVideo, isPlaying]);

  // ========== 정밀 재생 모드 (setInterval 기반) ==========

  useEffect(() => {
    // 재생 중이 아니거나 데이터가 없으면 정밀 모드 비활성화
    if (!isPlaying || !blendshapeData || blendshapeData.totalFrames === 0 || fps <= 0) {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      setLatency(0);
      return;
    }

    // 정밀 재생 모드 시작
    // playbackRate를 적용하여 재생 속도 조절
    const frameInterval = (1000 / fps) / playbackRate; // 밀리초
    let frameIndex = currentFrameRef.current;
    const startTime = performance.now();
    
    // 시작 프레임의 정확한 시간 가져오기 (CSV에서)
    const startFrameData = getFrameData(frameIndex);
    const startFrameTime = startFrameData && startFrameData.time !== undefined 
      ? startFrameData.time 
      : (frameIndex / fps);

    playbackIntervalRef.current = setInterval(() => {
      const now = performance.now();
      
      // 다음 프레임으로 이동
      frameIndex++;
      const maxFrame = blendshapeData.maxFrame !== undefined 
        ? blendshapeData.maxFrame 
        : (blendshapeData.totalFrames - 1);
      
      if (frameIndex > maxFrame) {
        // 끝에 도달하면 정지
        setIsPlaying(false);
        if (playbackIntervalRef.current) {
          clearInterval(playbackIntervalRef.current);
          playbackIntervalRef.current = null;
        }
        setLatency(0);
        return;
      }

      // CSV에서 해당 프레임 데이터 가져오기
      const frameData = getFrameData(frameIndex);
      
      if (!frameData) {
        // 프레임 데이터가 없으면 건너뛰기
        return;
      }

      // CSV에 저장된 정확한 비디오 시간 사용
      const time = frameData.time !== undefined ? frameData.time : (frameIndex / fps);
      
      // 프레임과 시간 업데이트 (비디오 시크 포함)
      updateFrameAndTime(frameIndex, time, true, 'playback');

      // Latency 계산
      if (videoRef?.current) {
        requestAnimationFrame(() => {
          const actualTime = videoRef.current?.currentTime || time;
          const expectedTime = time;
          const latencyMs = (actualTime - expectedTime) * 1000;
          setLatency(latencyMs);
          
          // Latency 로그
          if (Math.abs(latencyMs) > 16.67) { // 1프레임 이상 차이
            console.log(`[동기화 playback] Latency 경고:`, {
              csvFrame: frameIndex,
              expectedTime: expectedTime.toFixed(6),
              actualTime: actualTime.toFixed(6),
              latencyMs: latencyMs.toFixed(2),
            });
          }
        });
      } else {
        setLatency(0);
      }

      lastFrameUpdateTimeRef.current = now;
    }, frameInterval);

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
      setLatency(0);
    };
  }, [isPlaying, blendshapeData, fps, playbackRate, getFrameData, updateFrameAndTime, videoRef]);

  // ========== 비디오 시간 업데이트 핸들러 ==========

  /**
   * 비디오 시간 업데이트 핸들러
   * 정밀 모드가 아닐 때만 사용 (시크 시)
   */
  const handleTimeUpdate = useCallback((time) => {
    // 정밀 재생 모드가 활성화되어 있으면 무시
    if (isPlaying && playbackIntervalRef.current) {
      return;
    }

    // 시크 중이면 무시
    if (isSeekingRef.current) {
      return;
    }

    // 시크한 시간과 일치하면 무시 (시크 완료 직후 handleTimeUpdate가 실행되는 경우 방지)
    if (seekedTimeRef.current !== null && Math.abs(time - seekedTimeRef.current) < 0.01) {
      return;
    }
    seekedTimeRef.current = null;

    // 값이 실제로 변경되었을 때만 setState 호출 (0.033초 = 1프레임 간격)
    if (Math.abs(currentTimeRef.current - time) > 0.033) {
      currentTimeRef.current = time;
      setCurrentTime(time);
    }
    
    // 데이터 상태 확인
    if (!blendshapeData || videoDuration <= 0 || blendshapeData.totalFrames <= 0) {
      return;
    }
    
    // 비디오 시간에서 가장 가까운 CSV 프레임 찾기
    const closestFrame = findClosestFrame(time);
    
    // 프레임이 변경되었을 때만 업데이트
    if (closestFrame !== currentFrameRef.current) {
      const frameData = getFrameData(closestFrame);
      const frameTime = frameData && frameData.time !== undefined 
        ? frameData.time 
        : (closestFrame / fps);
      
      updateFrameAndTime(closestFrame, frameTime, false, 'timeupdate'); // 시크는 하지 않음 (비디오가 이미 해당 시간에 있음)
    } else {
      // 프레임이 변경되지 않아도 비디오 시간이 변경되었을 수 있으므로 비디오 프레임 번호 업데이트
      const videoFrame = Math.floor(time * fps);
      if (videoFrame !== videoFrameNumber) {
        setVideoFrameNumber(videoFrame);
      }
    }
  }, [blendshapeData, videoDuration, fps, isPlaying, findClosestFrame, getFrameData, updateFrameAndTime, videoFrameNumber]);

  // ========== 프레임 시크 핸들러 ==========

  /**
   * 프레임 시크 핸들러
   * @param {number} frame - CSV 프레임 번호 (0-based)
   */
  const handleSeek = useCallback((frame) => {
    // 이미 시크 중이면 무시
    if (isSeekingRef.current) {
      return;
    }
    
    if (!blendshapeData) return;
    
    const oldFrame = currentFrameRef.current;
    const oldTime = currentTimeRef.current;
    
    // CSV의 프레임 번호 범위 확인
    const minFrame = blendshapeData.minFrame !== undefined ? blendshapeData.minFrame : 0;
    const maxFrame = blendshapeData.maxFrame !== undefined ? blendshapeData.maxFrame : (blendshapeData.totalFrames - 1);
    const clampedFrame = Math.min(Math.max(minFrame, frame), maxFrame);
    
    // CSV에서 해당 프레임 데이터 가져오기
    const frameData = getFrameData(clampedFrame);
    
    if (!frameData) {
      return;
    }
    
    // CSV에 저장된 정확한 비디오 시간 사용 (없으면 FPS로 계산)
    const time = frameData.time !== undefined ? frameData.time : (clampedFrame / fps);
    
    // 재생 중이면 일시정지 (정밀 재생 모드 정리)
    if (isPlaying) {
      setIsPlaying(false);
    }
    
    // 프레임과 시간 업데이트 (비디오 시크 포함)
    updateFrameAndTime(clampedFrame, time, true, 'seek');
    
    // 타이밍 로거에 시크 기록
    timingLogger.logSeek(oldFrame, clampedFrame, oldTime, time);
    
    // 시크 상세 로그
    console.log(`[동기화 seek] 상세:`, {
      oldFrame,
      newFrame: clampedFrame,
      frameDelta: clampedFrame - oldFrame,
      oldTime: oldTime.toFixed(6),
      newTime: time.toFixed(6),
      timeDelta: (time - oldTime).toFixed(6),
      videoFrame: Math.floor(time * fps),
    });
  }, [blendshapeData, fps, isPlaying, getFrameData, updateFrameAndTime]);

  // ========== 이전/다음 프레임 핸들러 ==========

  /**
   * 이전 프레임 핸들러
   */
  const handlePrevFrame = useCallback(() => {
    if (!blendshapeData) {
      console.log(`[동기화 prev] 실패: blendshapeData 없음`);
      return;
    }
    
    const currentFrameValue = currentFrameRef.current;
    const minFrame = blendshapeData.minFrame !== undefined ? blendshapeData.minFrame : 0;
    
    console.log(`[동기화 prev] 시작:`, {
      currentFrame: currentFrameValue,
      minFrame,
      canGoPrev: currentFrameValue > minFrame,
    });
    
    if (currentFrameValue > minFrame) {
      const newFrame = currentFrameValue - 1;
      const frameData = getFrameData(newFrame);
      
      if (frameData) {
        const videoTime = frameData.time !== undefined ? frameData.time : (newFrame / fps);
        updateFrameAndTime(newFrame, videoTime, true, 'prev');
      } else {
        console.warn(`[동기화 prev] 실패: 프레임 ${newFrame} 데이터 없음`);
      }
    } else {
      console.log(`[동기화 prev] 실패: 최소 프레임에 도달 (${currentFrameValue} <= ${minFrame})`);
    }
  }, [blendshapeData, fps, getFrameData, updateFrameAndTime]);

  /**
   * 다음 프레임 핸들러
   */
  const handleNextFrame = useCallback(() => {
    if (!blendshapeData) {
      console.log(`[동기화 next] 실패: blendshapeData 없음`);
      return;
    }
    
    const currentFrameValue = currentFrameRef.current;
    const maxFrame = blendshapeData.maxFrame !== undefined ? blendshapeData.maxFrame : (blendshapeData.totalFrames - 1);
    
    console.log(`[동기화 next] 시작:`, {
      currentFrame: currentFrameValue,
      maxFrame,
      canGoNext: currentFrameValue < maxFrame,
    });
    
    if (currentFrameValue < maxFrame) {
      const newFrame = currentFrameValue + 1;
      const frameData = getFrameData(newFrame);
      
      if (frameData) {
        const videoTime = frameData.time !== undefined ? frameData.time : (newFrame / fps);
        updateFrameAndTime(newFrame, videoTime, true, 'next');
      } else {
        console.warn(`[동기화 next] 실패: 프레임 ${newFrame} 데이터 없음`);
      }
    } else {
      console.log(`[동기화 next] 실패: 최대 프레임에 도달 (${currentFrameValue} >= ${maxFrame})`);
    }
  }, [blendshapeData, fps, getFrameData, updateFrameAndTime]);

  // ========== 현재 프레임의 블렌드쉐입 데이터 가져오기 ==========

  /**
   * 현재 프레임의 블렌드쉐입 데이터 가져오기
   * @returns {Object|null} 현재 프레임의 블렌드쉐입 데이터
   */
  const getCurrentBlendshapeData = useCallback(() => {
    if (!blendshapeData) return null;
    
    const frameNum = currentFrameRef.current;
    
    if (blendshapeData.framesMap) {
      return blendshapeData.framesMap[frameNum] || null;
    }
    return blendshapeData.frames[frameNum] || null;
  }, [blendshapeData]);

  // ========== 반환값 ==========

  return {
    // 상태
    currentFrame,
    currentTime,
    isPlaying,
    videoFrameNumber,
    latency,
    
    // 제어 함수
    setIsPlaying,
    handleSeek,
    handlePrevFrame,
    handleNextFrame,
    handleTimeUpdate,
    
    // 유틸리티 함수
    getCurrentBlendshapeData,
    
    // Refs (필요시 직접 접근)
    currentFrameRef,
    currentTimeRef,
    playbackIntervalRef,
  };
}
