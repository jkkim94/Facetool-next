'use client';

import { useRef, useEffect } from 'react';

export default function VideoPlayer({
  videoPath,
  currentTime,
  isPlaying,
  playbackRate,
  onTimeUpdate,
  onPlay,
  onPause,
  onLoadedMetadata,
  onError,
  videoRef: externalVideoRef,
  currentFrame,
  totalFrames,
}) {
  const internalVideoRef = useRef(null);
  const videoRef = externalVideoRef || internalVideoRef;

  // 비디오 메타데이터 로드
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (onLoadedMetadata && video.duration > 0) {
        onLoadedMetadata({
          duration: video.duration,
          fps: 30, // 기본값
        });
      }
    };

    // 이미 로드된 경우 즉시 호출
    if (video.readyState >= 1 && video.duration > 0) {
      handleLoadedMetadata();
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onLoadedMetadata]);

  // currentTime 동기화 (시크 시에만)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const timeDiff = Math.abs(video.currentTime - currentTime);
    // 시크 시에만 동기화 (0.016초 = 약 1프레임 이상 차이날 때)
    // handleSeek에서 이미 시크하므로 여기서는 큰 차이만 처리
    if (timeDiff > 0.1) {
      // 비디오가 일시정지 상태에서 시크
      const wasPlaying = !video.paused;
      if (wasPlaying) {
        video.pause();
      }
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  // 재생 속도 설정
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (playbackRate !== undefined && playbackRate >= 0.1 && playbackRate <= 1.0) {
      video.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 재생/일시정지
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // play() promise를 추적하여 중복 호출 방지
    let playPromise = null;

    if (isPlaying) {
      // 비디오가 로드될 때까지 기다림
      const tryPlay = () => {
        // readyState >= 1 (HAVE_METADATA)이면 재생 시도 가능
        if (video.readyState >= 1) {
          // 이미 재생 중이면 무시
          if (!video.paused) return;
          
          playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                playPromise = null;
              })
              .catch(err => {
                playPromise = null;
                // pause()로 인한 중단은 정상적인 동작이므로 에러로 처리하지 않음
                if (err.name !== 'AbortError' && !video.paused) {
                  console.error('[비디오] 재생 오류:', err);
                  if (onError) {
                    onError({
                      code: -1,
                      message: err.message || '재생할 수 없습니다',
                      description: `비디오 재생 실패: ${err.message || '알 수 없는 오류'}`,
                      path: videoPath,
                    });
                  }
                }
              });
          }
        } else {
          // 비디오가 아직 로드되지 않았으면 여러 이벤트 대기
          const tryPlayOnce = () => {
            if (video.readyState >= 1 && isPlaying) {
              tryPlay();
            }
          };
          // { once: true } 옵션을 사용하면 자동으로 제거되므로 별도 추적 불필요
          video.addEventListener('loadedmetadata', tryPlayOnce, { once: true });
          video.addEventListener('loadeddata', tryPlayOnce, { once: true });
          video.addEventListener('canplay', tryPlayOnce, { once: true });
        }
      };
      tryPlay();
    } else {
      // 일시정지 시 play promise가 있으면 무시
      if (playPromise) {
        playPromise.catch(() => {}); // 에러 무시
        playPromise = null;
      }
      video.pause();
    }

    // cleanup: play promise 정리
    return () => {
      if (playPromise) {
        playPromise.catch(() => {});
        playPromise = null;
      }
    };
  }, [isPlaying, onError, videoPath]);

  // requestAnimationFrame으로 매 프레임마다 시간 업데이트
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onTimeUpdate) return;

    let rafId = null;
    let isActive = true;
    let lastUpdateTime = -1;
    
    const updateTime = () => {
      if (!isActive) return;
      
      if (video.readyState >= 2) {
        const currentTime = video.currentTime;
        // 30fps 기준으로 약 33ms마다 업데이트 (너무 자주 호출 방지)
        if (Math.abs(currentTime - lastUpdateTime) >= 0.033) {
          onTimeUpdate(currentTime);
          lastUpdateTime = currentTime;
        }
      }
      
      // 항상 requestAnimationFrame 계속 실행
      if (isActive) {
        rafId = requestAnimationFrame(updateTime);
      }
    };

    // requestAnimationFrame 시작
    rafId = requestAnimationFrame(updateTime);

    return () => {
      isActive = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [onTimeUpdate]);

  // 에러 처리
  const handleError = (e) => {
    const video = videoRef.current;
    if (video && video.error) {
      const code = video.error.code;
      let description = `비디오 로드 오류 (코드: ${code})`;
      if (code === 4) {
        description = '브라우저가 이 비디오를 재생할 수 없습니다. 가능한 원인: (1) 코덱 미지원 - H.264(AVC) MP4 권장, HEVC/H.265는 Chrome에서 재생 안 됨 (2) 해상도 - 가로/세로가 4의 배수여야 함 (예: 534x534는 불가, 532x532 또는 536x536 권장)';
      }
      const errorInfo = {
        code,
        message: video.error.message,
        description,
        path: videoPath,
        networkState: video.networkState,
        readyState: video.readyState,
      };
      
      if (onError) {
        onError(errorInfo);
      }
    } else {
      console.error('비디오 로드 오류 (비디오 요소 없음)');
      if (onError) {
        onError({
          code: -1,
          message: '비디오 요소를 찾을 수 없습니다',
          description: '비디오 요소가 초기화되지 않았습니다',
          path: videoPath,
        });
      }
    }
  };

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden relative">
      <video
        ref={videoRef}
        src={videoPath}
        className="w-full h-full object-contain"
        onPlay={() => {
          if (onPlay) onPlay();
        }}
        onPause={() => {
          if (onPause) onPause();
        }}
        onError={handleError}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
      >
        비디오를 재생할 수 없습니다. 브라우저가 이 형식을 지원하지 않거나 파일을 찾을 수 없습니다.
      </video>
      {/* 프레임 번호 표시 - 좌상단 */}
      {currentFrame !== undefined && totalFrames !== undefined && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs font-mono z-10">
          Frame: {currentFrame} / {totalFrames}
        </div>
      )}
    </div>
  );
}
