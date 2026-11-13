'use client';

import { useState, useEffect } from 'react';
import timingLogger from '@/lib/timingLogger';

export default function TimingLoggerPanel() {
  const [isRecording, setIsRecording] = useState(false);
  const [stats, setStats] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // 통계 업데이트 (1초마다)
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      const currentStats = timingLogger.getStats();
      setStats(currentStats);
      setRecentLogs(timingLogger.getRecentLogs(20));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording]);

  const handleStartRecording = () => {
    timingLogger.startRecording();
    setIsRecording(true);
    setStats(null);
    setRecentLogs([]);
  };

  const handleStopRecording = () => {
    timingLogger.stopRecording();
    setIsRecording(false);
    const finalStats = timingLogger.getStats();
    setStats(finalStats);
    setRecentLogs(timingLogger.getRecentLogs(20));
  };

  const handleDownloadCSV = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    timingLogger.downloadCSV(`timing_log_${timestamp}.csv`);
  };

  const handleClear = () => {
    timingLogger.clear();
    setIsRecording(false);
    setStats(null);
    setRecentLogs([]);
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* 헤더 - 항상 표시 */}
      <div className="p-2 flex items-center justify-between border-b border-gray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-white font-semibold text-sm hover:text-blue-400"
        >
          <span>{isExpanded ? '▼' : '▶'}</span>
          <span>타이밍 로거</span>
          {isRecording && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-xs rounded animate-pulse">
              <span className="w-2 h-2 bg-white rounded-full"></span>
              REC
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 font-semibold"
            >
              기록 시작
            </button>
          ) : (
            <button
              onClick={handleStopRecording}
              className="px-3 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 font-semibold"
            >
              기록 중지
            </button>
          )}
          
          {stats && (
            <button
              onClick={handleDownloadCSV}
              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-semibold"
              title="타이밍 로그를 CSV 파일로 다운로드"
            >
              CSV 다운로드
            </button>
          )}
          
          {stats && !isRecording && (
            <button
              onClick={handleClear}
              className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
              title="로그 초기화"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 확장된 내용 */}
      {isExpanded && (
        <div className="p-3">
          {/* 통계 정보 */}
          {stats && (
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-gray-400">총 로그 수</div>
                <div className="text-white font-bold text-lg">{stats.totalLogs}</div>
              </div>
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-gray-400">기록 시간</div>
                <div className="text-white font-bold text-lg">
                  {(stats.recordingDuration / 1000).toFixed(2)}초
                </div>
              </div>
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-gray-400">비디오 프레임</div>
                <div className="text-white font-bold text-lg">{stats.videoFrames}</div>
              </div>
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-gray-400">블렌드쉐입 적용</div>
                <div className="text-white font-bold text-lg">{stats.blendshapeApplies}</div>
              </div>
            </div>
          )}

          {/* 최근 로그 */}
          {recentLogs.length > 0 && (
            <div>
              <h4 className="text-white text-xs font-semibold mb-2">
                최근 로그 (최근 20개)
              </h4>
              <div className="bg-gray-900 rounded p-2 max-h-64 overflow-y-auto">
                <div className="space-y-1">
                  {recentLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className="text-xs font-mono text-gray-300 border-b border-gray-800 pb-1"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className={`font-semibold ${
                          log.eventType === 'VIDEO_FRAME' ? 'text-blue-400' :
                          log.eventType === 'BLENDSHAPE_APPLY' ? 'text-green-400' :
                          log.eventType === 'PLAYBACK_CHANGE' ? 'text-yellow-400' :
                          log.eventType === 'SEEK' ? 'text-purple-400' :
                          'text-gray-400'
                        }`}>
                          {log.eventType}
                        </span>
                        <span className="text-gray-500">
                          {log.relativeTime.toFixed(1)}ms
                        </span>
                      </div>
                      <div className="text-gray-400 mt-0.5">
                        {log.eventType === 'VIDEO_FRAME' && (
                          <>
                            비디오: {log.videoTime?.toFixed(3)}초 | 프레임: {log.frameNumber}
                          </>
                        )}
                        {log.eventType === 'BLENDSHAPE_APPLY' && (
                          <>
                            프레임: {log.currentFrame} | CSV 프레임: {log.csvFrame} | 
                            활성: {log.activeBlendshapeCount}개
                          </>
                        )}
                        {log.eventType === 'PLAYBACK_CHANGE' && (
                          <>
                            {log.isPlaying ? '재생 시작' : '일시정지'} | 
                            시간: {log.videoTime?.toFixed(3)}초
                          </>
                        )}
                        {log.eventType === 'SEEK' && (
                          <>
                            프레임: {log.fromFrame} → {log.toFrame}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 안내 메시지 */}
          {!stats && !isRecording && (
            <div className="text-center text-gray-400 text-xs py-4">
              '기록 시작' 버튼을 클릭하여 타이밍 로깅을 시작하세요.
              <br />
              비디오 재생 시간과 CSV 블렌드쉐입 적용 타이밍이 실시간으로 기록됩니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
