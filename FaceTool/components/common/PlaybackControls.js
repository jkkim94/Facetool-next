'use client';

import { useState, useRef, useEffect } from 'react';

export default function PlaybackControls({
  isPlaying,
  currentFrame,
  totalFrames,
  currentTime,
  duration,
  playbackRate,
  onPlay,
  onPause,
  onSeek,
  onPlaybackRateChange,
}) {
  const [isEditingFrame, setIsEditingFrame] = useState(false);
  const [frameInputValue, setFrameInputValue] = useState(String(currentFrame + 1));
  const frameInputRef = useRef(null);

  // currentFrame이 변경되면 입력값 업데이트
  useEffect(() => {
    if (!isEditingFrame) {
      setFrameInputValue(String(currentFrame + 1));
    }
  }, [currentFrame, isEditingFrame]);

  // 입력 필드가 활성화되면 포커스
  useEffect(() => {
    if (isEditingFrame && frameInputRef.current) {
      frameInputRef.current.focus();
      frameInputRef.current.select();
    }
  }, [isEditingFrame]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSliderChange = (e) => {
    const frame = parseInt(e.target.value, 10);
    onSeek(frame);
  };

  const handlePlaybackRateChange = (e) => {
    const rate = parseFloat(e.target.value);
    if (onPlaybackRateChange) {
      onPlaybackRateChange(rate);
    }
  };

  const handleFrameInputClick = () => {
    setIsEditingFrame(true);
    // 재생 중이면 일시정지
    if (isPlaying && onPause) {
      onPause();
    }
  };

  const handleFrameInputChange = (e) => {
    setFrameInputValue(e.target.value);
  };

  const handleFrameInputBlur = () => {
    setIsEditingFrame(false);
    const frameNum = parseInt(frameInputValue, 10);
    if (!isNaN(frameNum) && frameNum >= 1 && frameNum <= totalFrames) {
      onSeek(frameNum - 1); // 0-based index로 변환
    } else {
      // 유효하지 않은 값이면 현재 프레임으로 복원
      setFrameInputValue(String(currentFrame + 1));
    }
  };

  const handleFrameInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur(); // blur 이벤트로 처리
    } else if (e.key === 'Escape') {
      setFrameInputValue(String(currentFrame + 1));
      setIsEditingFrame(false);
      e.target.blur();
    }
  };

  return (
    <div className="w-full bg-gray-800 p-4 rounded-lg">
      <div className="flex items-center gap-4 mb-2">
        <button
          onClick={(e) => {
            e.preventDefault();
            console.log('[재생 컨트롤] 버튼 클릭:', isPlaying ? '일시정지' : '재생');
            if (isPlaying) {
              if (onPause) onPause();
            } else {
              if (onPlay) onPlay();
            }
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {isPlaying ? '일시정지' : '재생'}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min="0"
            max={totalFrames - 1}
            value={currentFrame}
            onChange={handleSliderChange}
            className="w-full"
          />
        </div>
        <div className="text-white text-sm">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <div className="text-white text-sm flex items-center gap-1">
          <span>프레임:</span>
          {isEditingFrame ? (
            <input
              ref={frameInputRef}
              type="number"
              min="1"
              max={totalFrames}
              value={frameInputValue}
              onChange={handleFrameInputChange}
              onBlur={handleFrameInputBlur}
              onKeyDown={handleFrameInputKeyDown}
              className="w-16 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <span
              onClick={handleFrameInputClick}
              className="px-1 py-0.5 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 font-mono select-none"
              title="클릭하여 프레임 번호 입력"
            >
              {currentFrame + 1}
            </span>
          )}
          <span>/</span>
          <span className="font-mono">{totalFrames}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-white text-sm whitespace-nowrap">재생 속도:</label>
        <input
          type="range"
          min="0.1"
          max="1.0"
          step="0.1"
          value={playbackRate || 1.0}
          onChange={handlePlaybackRateChange}
          className="flex-1"
        />
        <span className="text-white text-sm font-mono w-12 text-right">
          {(playbackRate || 1.0).toFixed(1)}x
        </span>
      </div>
    </div>
  );
}
