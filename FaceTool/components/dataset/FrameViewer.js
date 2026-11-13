'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 정확한 프레임 이미지를 표시하는 컴포넌트
 * OpenCV와 동일하게 정확한 프레임 번호로 이미지를 추출하여 표시
 */
export default function FrameViewer({
  fileName,
  currentFrame,
  totalFrames,
  fps = 30,
  onFrameChange,
  className = '',
}) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const abortControllerRef = useRef(null);
  
  // 프레임 이미지 로드
  const loadFrame = useCallback(async (frame) => {
    if (!fileName) return;
    
    // 이전 요청 취소
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);
    
    try {
      const url = `/api/frame?name=${encodeURIComponent(fileName)}&frame=${frame}&fps=${fps}`;
      const res = await fetch(url, {
        signal: abortControllerRef.current.signal,
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Failed to load frame ${frame}`);
      }
      
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      // 이전 이미지 URL 해제
      if (imageSrc) {
        URL.revokeObjectURL(imageSrc);
      }
      
      setImageSrc(objectUrl);
      setError(null);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Frame load error:', err);
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [fileName, fps, imageSrc]);
  
  // 프레임 변경 시 이미지 로드
  useEffect(() => {
    loadFrame(currentFrame);
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [currentFrame, fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // 이미지 로드 완료 시 크기 저장
  const handleImageLoad = (e) => {
    setImageSize({
      width: e.target.naturalWidth,
      height: e.target.naturalHeight,
    });
  };
  
  // 키보드 이벤트 핸들러
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!containerRef.current?.contains(document.activeElement)) return;
      
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        if (currentFrame > 0 && onFrameChange) {
          onFrameChange(currentFrame - 1);
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        e.preventDefault();
        if (currentFrame < totalFrames - 1 && onFrameChange) {
          onFrameChange(currentFrame + 1);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrame, totalFrames, onFrameChange]);
  
  return (
    <div 
      ref={containerRef}
      className={`relative flex flex-col h-full ${className}`}
      tabIndex={0}
    >
      {/* 프레임 정보 헤더 */}
      <div className="flex items-center justify-between px-2 py-1 bg-gray-800 border-b border-gray-700 text-xs flex-shrink-0">
        <span className="text-gray-400">
          Frame: <span className="text-white font-mono">{currentFrame}</span> / {totalFrames - 1}
        </span>
        {imageSize.width > 0 && (
          <span className="text-gray-500">
            {imageSize.width}x{imageSize.height}
          </span>
        )}
        <span className="text-green-400 text-[10px]">
          Exact Frame Mode
        </span>
      </div>
      
      {/* 이미지 영역 */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="text-white text-sm">Loading frame {currentFrame}...</div>
          </div>
        )}
        
        {error ? (
          <div className="text-red-400 text-sm p-4 text-center">
            {error}
          </div>
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={`Frame ${currentFrame}`}
            onLoad={handleImageLoad}
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="text-gray-500 text-sm">
            No frame loaded
          </div>
        )}
      </div>
      
      {/* 프레임 네비게이션 */}
      <div className="flex items-center justify-center gap-2 px-2 py-1 bg-gray-800 border-t border-gray-700 flex-shrink-0">
        <button
          onClick={() => onFrameChange?.(0)}
          disabled={currentFrame === 0}
          className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600"
          title="First frame"
        >
          |◀
        </button>
        <button
          onClick={() => onFrameChange?.(Math.max(0, currentFrame - 10))}
          disabled={currentFrame === 0}
          className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600"
          title="-10 frames"
        >
          ◀◀
        </button>
        <button
          onClick={() => onFrameChange?.(currentFrame - 1)}
          disabled={currentFrame === 0}
          className="px-3 py-1 bg-blue-600 rounded text-xs disabled:opacity-50 hover:bg-blue-500 font-semibold"
          title="Previous frame (← or A)"
        >
          ◀ Prev
        </button>
        
        <input
          type="number"
          value={currentFrame}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 0 && val < totalFrames) {
              onFrameChange?.(val);
            }
          }}
          className="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-center text-white font-mono"
          min={0}
          max={totalFrames - 1}
        />
        
        <button
          onClick={() => onFrameChange?.(currentFrame + 1)}
          disabled={currentFrame >= totalFrames - 1}
          className="px-3 py-1 bg-blue-600 rounded text-xs disabled:opacity-50 hover:bg-blue-500 font-semibold"
          title="Next frame (→ or D)"
        >
          Next ▶
        </button>
        <button
          onClick={() => onFrameChange?.(Math.min(totalFrames - 1, currentFrame + 10))}
          disabled={currentFrame >= totalFrames - 1}
          className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600"
          title="+10 frames"
        >
          ▶▶
        </button>
        <button
          onClick={() => onFrameChange?.(totalFrames - 1)}
          disabled={currentFrame >= totalFrames - 1}
          className="px-2 py-1 bg-gray-700 rounded text-xs disabled:opacity-50 hover:bg-gray-600"
          title="Last frame"
        >
          ▶|
        </button>
      </div>
    </div>
  );
}
