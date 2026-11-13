export async function parseBlendshapeCSV(csvPath) {
  try {
    const response = await fetch(csvPath);
    
    // HTTP 응답 상태 확인
    if (!response.ok) {
      throw new Error(`CSV 파일을 불러올 수 없습니다. 상태 코드: ${response.status}`);
    }
    
    const text = await response.text();
    
    // 빈 응답 확인
    if (!text || text.trim().length === 0) {
      throw new Error('CSV 파일이 비어있습니다.');
    }
    
    const lines = text.trim().split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length < 2) {
      throw new Error(`CSV 파일이 비어있거나 형식이 올바르지 않습니다. (줄 수: ${lines.length})`);
    }

    // 헤더 파싱
    const headers = lines[0].split(',').map(h => h.trim());
    
    if (headers.length < 2) {
      throw new Error('CSV 헤더가 올바르지 않습니다. 최소 2개의 열이 필요합니다.');
    }
    
    // 헤더에서 Frame과 Time 위치 확인
    const frameIndex = headers.indexOf('Frame');
    const timeIndex = headers.indexOf('Time');
    const hasTimeColumn = timeIndex !== -1;
    
    // blendshapeNames는 Frame과 Time을 제외한 나머지
    const blendshapeNames = hasTimeColumn 
      ? headers.filter((h, idx) => idx !== frameIndex && idx !== timeIndex)
      : headers.slice(1); // Time이 없으면 첫 번째(Frame)만 제외

    // 데이터 파싱 - 프레임 번호를 키로 하는 맵 생성
    const framesArray = [];
    const framesMap = {}; // 프레임 번호를 키로 하는 맵
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      
      // 빈 줄 건너뛰기
      if (values.length === 0 || (values.length === 1 && values[0] === '')) {
        continue;
      }
      
      const csvFrameNumber = parseInt(values[frameIndex !== -1 ? frameIndex : 0], 10) || 0;
      
      // 비디오 프레임의 정확한 시간 읽기 (Time 컬럼이 있으면 사용, 없으면 계산)
      let videoTime;
      if (hasTimeColumn && timeIndex < values.length) {
        videoTime = parseFloat(values[timeIndex]) || (csvFrameNumber / 30.0);
      } else {
        // Time 컬럼이 없으면 FPS로 계산 (기존 CSV 호환성)
        videoTime = csvFrameNumber / 30.0;
      }
      
      const frame = {
        frame: csvFrameNumber, // CSV의 프레임 번호
        time: videoTime, // 비디오 프레임의 정확한 시간
      };
      
      // blendshape 값들 저장
      let blendshapeIdx = 0;
      for (let j = 0; j < headers.length; j++) {
        if (j !== frameIndex && j !== timeIndex && j < values.length) {
          const blendshapeName = blendshapeNames[blendshapeIdx];
          if (blendshapeName) {
            frame[blendshapeName] = parseFloat(values[j]) || 0;
            blendshapeIdx++;
          }
        }
      }
      
      framesArray.push(frame);
      framesMap[csvFrameNumber] = frame; // 프레임 번호를 키로 저장
    }

    if (framesArray.length === 0) {
      throw new Error('CSV 파일에 데이터가 없습니다.');
    }

    // 최소/최대 프레임 번호 찾기
    const frameNumbers = Object.keys(framesMap).map(Number).sort((a, b) => a - b);
    const minFrame = frameNumbers[0];
    const maxFrame = frameNumbers[frameNumbers.length - 1];

    return {
      frames: framesArray, // 배열 (호환성 유지)
      framesMap: framesMap, // 프레임 번호를 키로 하는 맵 (새로 추가)
      blendshapeNames,
      totalFrames: framesArray.length,
      minFrame: minFrame,
      maxFrame: maxFrame,
    };
  } catch (error) {
    // 네트워크 에러나 기타 에러 처리
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`CSV 파일을 불러올 수 없습니다. 경로를 확인해주세요: ${csvPath}`);
    }
    throw error;
  }
}
