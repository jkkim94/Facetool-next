/**
 * 타이밍 로거 - 비디오 재생과 CSV 블렌드쉐입 적용 타이밍을 실시간으로 기록
 * 파일 저장으로 인한 지연 없이 메모리에 기록
 */

class TimingLogger {
  constructor() {
    this.logs = [];
    this.startTime = null;
    this.isRecording = false;
  }

  /**
   * 기록 시작
   */
  startRecording() {
    this.logs = [];
    this.startTime = performance.now();
    this.isRecording = true;
    this.log('RECORDING_START', {
      isoTimestamp: new Date().toISOString(),
      performanceNow: this.startTime
    });
  }

  /**
   * 기록 중지
   */
  stopRecording() {
    if (!this.isRecording) return;
    
    const endTime = performance.now();
    this.log('RECORDING_END', {
      isoTimestamp: new Date().toISOString(),
      performanceNow: endTime,
      totalDuration: endTime - this.startTime
    });
    this.isRecording = false;
  }

  /**
   * 로그 기록 (고성능, 지연 없음)
   * @param {string} eventType - 이벤트 타입
   * @param {object} data - 기록할 데이터
   */
  log(eventType, data) {
    if (!this.isRecording && eventType !== 'RECORDING_START') return;

    const entry = {
      eventType,
      relativeTime: this.startTime ? performance.now() - this.startTime : 0,
      timestamp: performance.now(),
      ...data
    };

    this.logs.push(entry);
  }

  /**
   * 비디오 프레임 업데이트 로그
   */
  logVideoFrame(videoTime, frameNumber) {
    this.log('VIDEO_FRAME', {
      videoTime,
      frameNumber
    });
  }

  /**
   * CSV 블렌드쉐입 적용 로그
   */
  logBlendshapeApply(frameNumber, csvFrameNumber, blendshapeData) {
    // 활성화된 블렌드쉐입만 기록 (값이 0.01 이상)
    const activeBlendshapes = {};
    let activeCount = 0;
    
    if (blendshapeData) {
      Object.entries(blendshapeData).forEach(([key, value]) => {
        if (key !== 'frame' && typeof value === 'number' && Math.abs(value) > 0.01) {
          activeBlendshapes[key] = value;
          activeCount++;
        }
      });
    }

    this.log('BLENDSHAPE_APPLY', {
      currentFrame: frameNumber,
      csvFrame: csvFrameNumber,
      activeBlendshapeCount: activeCount,
      activeBlendshapes: activeCount > 0 ? activeBlendshapes : null
    });
  }

  /**
   * 재생 상태 변경 로그
   */
  logPlaybackChange(isPlaying, videoTime, frameNumber) {
    this.log('PLAYBACK_CHANGE', {
      isPlaying,
      videoTime,
      frameNumber
    });
  }

  /**
   * 시크 이벤트 로그
   */
  logSeek(fromFrame, toFrame, fromTime, toTime) {
    this.log('SEEK', {
      fromFrame,
      toFrame,
      fromTime,
      toTime
    });
  }

  /**
   * CSV 로드 완료 로그
   */
  logCsvLoaded(csvId, totalFrames, blendshapeCount) {
    this.log('CSV_LOADED', {
      csvId,
      totalFrames,
      blendshapeCount
    });
  }

  /**
   * 로그 초기화
   */
  clear() {
    this.logs = [];
    this.startTime = null;
    this.isRecording = false;
  }

  /**
   * 로그 데이터를 CSV 형식으로 변환
   */
  toCSV() {
    if (this.logs.length === 0) {
      return 'No data';
    }

    // CSV 헤더
    const headers = [
      'eventType',
      'relativeTime_ms',
      'timestamp_ms',
      'videoTime_sec',
      'frameNumber',
      'csvFrame',
      'isPlaying',
      'activeBlendshapeCount',
      'details'
    ];

    // CSV 행 생성
    const rows = this.logs.map(entry => {
      // details 컬럼에 추가 정보 포함
      const details = {
        ...(entry.activeBlendshapes && { activeBlendshapes: entry.activeBlendshapes }),
        ...(entry.isoTimestamp && { isoTimestamp: entry.isoTimestamp }),
        ...(entry.performanceNow && { performanceNow: entry.performanceNow }),
        ...(entry.totalDuration && { totalDuration: entry.totalDuration }),
        ...(entry.fromFrame !== undefined && { fromFrame: entry.fromFrame, toFrame: entry.toFrame }),
        ...(entry.fromTime !== undefined && { fromTime: entry.fromTime, toTime: entry.toTime })
      };
      
      return [
        entry.eventType,
        entry.relativeTime.toFixed(3),
        entry.timestamp.toFixed(3),
        entry.videoTime !== undefined ? entry.videoTime.toFixed(6) : '',
        entry.frameNumber !== undefined ? entry.frameNumber : entry.currentFrame !== undefined ? entry.currentFrame : '',
        entry.csvFrame !== undefined ? entry.csvFrame : '',
        entry.isPlaying !== undefined ? entry.isPlaying : '',
        entry.activeBlendshapeCount !== undefined ? entry.activeBlendshapeCount : '',
        Object.keys(details).length > 0 ? JSON.stringify(details) : ''
      ];
    });

    // CSV 문자열 생성
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return csvContent;
  }

  /**
   * CSV 파일로 다운로드
   */
  downloadCSV(filename = 'timing_log.csv') {
    const csvContent = this.toCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * 로그 통계 정보
   */
  getStats() {
    if (this.logs.length === 0) {
      return null;
    }

    const stats = {
      totalLogs: this.logs.length,
      recordingDuration: this.logs[this.logs.length - 1]?.relativeTime || 0,
      eventCounts: {},
      videoFrames: 0,
      blendshapeApplies: 0
    };

    this.logs.forEach(entry => {
      stats.eventCounts[entry.eventType] = (stats.eventCounts[entry.eventType] || 0) + 1;
      
      if (entry.eventType === 'VIDEO_FRAME') {
        stats.videoFrames++;
      } else if (entry.eventType === 'BLENDSHAPE_APPLY') {
        stats.blendshapeApplies++;
      }
    });

    return stats;
  }

  /**
   * 최근 N개 로그 가져오기
   */
  getRecentLogs(count = 10) {
    return this.logs.slice(-count);
  }

  /**
   * 기록 중 여부
   */
  isCurrentlyRecording() {
    return this.isRecording;
  }
}

// 싱글톤 인스턴스
const timingLogger = new TimingLogger();

export default timingLogger;
