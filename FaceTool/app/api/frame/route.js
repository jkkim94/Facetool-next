import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { clipNameForVideoLookup } from '../utils/clipNameForVideoLookup';

const MP4_DIR = 'E:\\DatasetGen\\MP4';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const frame = parseInt(searchParams.get('frame') || '0', 10);
    const fps = parseFloat(searchParams.get('fps') || '30');
    
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    // _speakerN, _styleN 은 비디오 검색과 무관하므로 제거한 이름으로 MP4 조회
    const lookupName = clipNameForVideoLookup(name);
    
    // MP4 파일 찾기
    const mp4Path = findMp4(lookupName);
    if (!mp4Path || !fs.existsSync(mp4Path)) {
      return NextResponse.json({ error: 'MP4 not found', name }, { status: 404 });
    }
    
    // 프레임을 시간으로 변환 (OpenCV와 동일하게 0-based)
    // FFmpeg select filter: eq(n,frame) 사용
    const tempFile = path.join(os.tmpdir(), `frame_${name}_${frame}_${Date.now()}.jpg`);
    
    try {
      // FFmpeg로 정확한 프레임 추출
      // -vf "select=eq(n\\,FRAME)" : 정확히 N번째 프레임 선택
      await extractFrame(mp4Path, frame, tempFile);
      
      if (!fs.existsSync(tempFile)) {
        return NextResponse.json({ error: 'Frame extraction failed' }, { status: 500 });
      }
      
      // 이미지 읽기
      const imageBuffer = fs.readFileSync(tempFile);
      
      // 임시 파일 삭제
      fs.unlinkSync(tempFile);
      
      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'X-Frame-Number': frame.toString(),
        },
      });
    } catch (err) {
      // 임시 파일 정리
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw err;
    }
  } catch (error) {
    console.error('Error extracting frame:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function extractFrame(mp4Path, frameNumber, outputPath) {
  return new Promise((resolve, reject) => {
    // FFmpeg select filter로 정확한 프레임 추출
    // eq(n, frameNumber)는 0-based 프레임 번호
    const args = [
      '-i', mp4Path,
      '-vf', `select=eq(n\\,${frameNumber})`,
      '-vframes', '1',
      '-q:v', '2',  // 품질 설정 (1-31, 낮을수록 좋음)
      '-y',
      outputPath
    ];
    
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

// MP4 파일 찾기 (재귀 검색)
function findMp4(name) {
  const searchDirs = [
    path.join(MP4_DIR, 'F(여성)'),
    path.join(MP4_DIR, 'M(남성)'),
    MP4_DIR,
  ];
  
  for (const dir of searchDirs) {
    const found = searchMp4InDir(dir, `${name}.mp4`);
    if (found) return found;
  }
  
  return null;
}

function searchMp4InDir(dir, filename) {
  try {
    if (!fs.existsSync(dir)) return null;
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        const found = searchMp4InDir(fullPath, filename);
        if (found) return found;
      } else if (item.name === filename) {
        return fullPath;
      }
    }
  } catch {
    // ignore errors
  }
  
  return null;
}
