/**
 * 프레임 이미지 시퀀스 API
 * - 미리 추출된 PNG/JPG 이미지 제공
 * - /api/frames?basePath=...&split=train&name=파일명&frame=0
 * - 다양한 프레임 폴더 구조 자동 감지 (재귀 검색 포함):
 *   1. {basePath}/{split}/{name}_frames/0000.png
 *   2. {basePath}/{name}_frames/0000.png
 *   3. {basePath}/frames/{name}/0000.png
 *   4. 재귀적으로 하위 폴더에서 {name}_frames 폴더 검색
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { clipNameForVideoLookup } from '../utils/clipNameForVideoLookup';

const DEFAULT_DATASET_DIR = 'E:\\DatasetGen';
const FRAMES_DIR = 'E:\\DatasetGen\\LipReading_Dataset_Frames';
const FRAME_SPLITS = ['train', 'val', 'test'];

// 알려진 하위 디렉토리 패턴
const DATA_SUBDIRS = ['LipReading_Dataset_Video', 'LipReading_Dataset_Synced'];
const FRAME_SUBDIRS = ['LipReading_Dataset_Frames'];

/**
 * 프로젝트 루트 경로에서 실제 데이터 디렉토리를 자동 감지합니다.
 */
function resolveDataDir(basePath) {
  const hasSplitDirect = ['train', 'val', 'test'].some(s => {
    const p = path.join(basePath, s);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  });
  if (hasSplitDirect) return basePath;

  try {
    const items = fs.readdirSync(basePath);
    const hasDataFiles = items.some(f => f.endsWith('.npy') || f.endsWith('.csv') || f.endsWith('.wav'));
    if (hasDataFiles) return basePath;
  } catch {}

  for (const subdir of DATA_SUBDIRS) {
    const candidate = path.join(basePath, subdir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return basePath;
}

/**
 * 프로젝트 루트에서 프레임 디렉토리를 찾습니다.
 */
function resolveFramesDir(basePath) {
  // 기본 FRAMES_DIR이 존재하면 사용
  if (fs.existsSync(FRAMES_DIR)) return FRAMES_DIR;

  // 프로젝트 루트에서 프레임 디렉토리 탐색
  for (const subdir of FRAME_SUBDIRS) {
    const candidate = path.join(basePath, subdir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return FRAMES_DIR;
}

const LANDMARK_SAMPLES_DIR = 'landmark_samples';

/**
 * LipReading_Dataset_Frames 하위 landmark_samples에서 {name}_frames 폴더를 찾습니다.
 */
function findFramesDirInLandmarkSamples(framesBaseDir, lookupName) {
  const landmarkRoot = path.join(framesBaseDir, LANDMARK_SAMPLES_DIR);
  if (!fs.existsSync(landmarkRoot) || !fs.statSync(landmarkRoot).isDirectory()) return null;
  const direct = path.join(landmarkRoot, `${lookupName}_frames`);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;
  const found = findFramesFolderRecursive(landmarkRoot, `${lookupName}_frames`, 8, 0);
  if (found) return found;
  const prefixMatch = lookupName.match(/^(.+)_\d+$/);
  if (prefixMatch) {
    const prefixDirect = path.join(landmarkRoot, `${prefixMatch[1]}_frames`);
    if (fs.existsSync(prefixDirect) && fs.statSync(prefixDirect).isDirectory()) return prefixDirect;
    return findFramesFolderRecursive(landmarkRoot, `${prefixMatch[1]}_frames`, 8, 0);
  }
  return null;
}

/**
 * LipReading_Dataset_Frames 하위 train/val/test에서 {name}_frames 폴더를 찾습니다.
 */
function findFramesDirInSplits(framesBaseDir, lookupName, preferSplit = '') {
  const splitsToTry = preferSplit && FRAME_SPLITS.includes(preferSplit)
    ? [preferSplit, ...FRAME_SPLITS.filter(s => s !== preferSplit)]
    : FRAME_SPLITS;
  for (const s of splitsToTry) {
    const dir = path.join(framesBaseDir, s, `${lookupName}_frames`);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  const prefixMatch = lookupName.match(/^(.+)_\d+$/);
  if (prefixMatch) {
    for (const s of splitsToTry) {
      const dir = path.join(framesBaseDir, s, `${prefixMatch[1]}_frames`);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    }
  }
  return null;
}

/**
 * LipReading_Dataset_Frames 하위에서 train/val/test만 검색 (landmark_samples 제외).
 * @param {string} framesBaseDir - LipReading_Dataset_Frames 경로
 * @param {string} folderName - 찾을 폴더명 (예: xxx_frames)
 * @returns {string|null} - 찾은 폴더의 전체 경로 또는 null
 */
function findFramesFolderInSplitsOnly(framesBaseDir, folderName) {
  for (const s of FRAME_SPLITS) {
    const dir = path.join(framesBaseDir, s, folderName);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  for (const s of FRAME_SPLITS) {
    const subDir = path.join(framesBaseDir, s);
    if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory()) continue;
    const found = findFramesFolderRecursive(subDir, folderName, 8, 0);
    if (found) return found;
  }
  return null;
}

/**
 * 재귀적으로 프레임 폴더를 찾습니다.
 * @param {string} dir - 검색할 디렉토리
 * @param {string} folderName - 찾을 폴더명 (예: xxx_frames)
 * @param {number} maxDepth - 최대 탐색 깊이
 * @param {number} currentDepth - 현재 깊이
 * @returns {string|null} - 찾은 폴더의 전체 경로 또는 null
 */
function findFramesFolderRecursive(dir, folderName, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;
  
  try {
    if (!fs.existsSync(dir)) return null;
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory()) {
        const fullPath = path.join(dir, item.name);
        
        // 찾는 폴더인지 확인
        if (item.name === folderName) {
          return fullPath;
        }
        
        // 하위 디렉토리 탐색 (다른 _frames 폴더는 스킵)
        if (!item.name.endsWith('_frames')) {
          const found = findFramesFolderRecursive(fullPath, folderName, maxDepth, currentDepth + 1);
          if (found) return found;
        }
      }
    }
  } catch (err) {
    console.error('Error searching frames folder:', dir, err.message);
  }
  
  return null;
}

/** 원본 파일명(stem)으로 데이터셋 프레임 조회 시 D3/D4/D8 접두사 후보 시도 (예: RD_Radio1_000_00 → D3_RD_Radio1_000_00_frames) */
function findFramesDirWithPrefixes(stem, framesBaseDir, targetDir, basePath) {
  if (/^D[348]_/i.test(stem)) return null;
  for (const prefix of ['D3_', 'D4_', 'D8_']) {
    const folderName = `${prefix}${stem}_frames`;
    let dir = findFramesFolderInSplitsOnly(framesBaseDir, folderName);
    if (dir) return dir;
    dir = findFramesFolderRecursive(targetDir, folderName);
    if (dir) return dir;
    if (basePath !== framesBaseDir) {
      dir = findFramesFolderRecursive(basePath, folderName);
      if (dir) return dir;
    }
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawBasePath = searchParams.get('basePath') || DEFAULT_DATASET_DIR;
  const split = searchParams.get('split') || '';
  const name = searchParams.get('name');
  const frameIndex = parseInt(searchParams.get('frame') || '0', 10);
  const useLandmarks = searchParams.get('useLandmarks') === 'true';
  
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  // _speakerN, _styleN 은 비디오/프레임 검색과 무관하므로 제거한 이름으로 조회
  const lookupName = clipNameForVideoLookup(name);
  
  // 프로젝트 루트에서 실제 디렉토리 자동 감지
  const basePath = resolveDataDir(rawBasePath);
  const framesBaseDir = resolveFramesDir(rawBasePath);
  
  // 타겟 디렉토리 결정
  const targetDir = split ? path.join(basePath, split) : basePath;
  
  let framesDir = null;
  
  // 랜드마크 모드: landmark_samples 우선 참조 (랜드마크가 찍힌 프레임), 없으면 train/val/test
  if (useLandmarks) {
    framesDir = findFramesDirInLandmarkSamples(framesBaseDir, lookupName);
    if (!framesDir) {
      framesDir = findFramesDirInSplits(framesBaseDir, lookupName, split || '');
    }
  }
  
  // 일반 프레임 또는 위에서 못 찾은 경우
  if (!framesDir) {
    // 다양한 프레임 폴더 구조 패턴 시도. LipReading_Dataset_Frames 하위는 train/val/test만 사용 (landmark_samples 제외)
    const frameFolderPatterns = [
      path.join(targetDir, `${lookupName}_frames`),           // {dir}/{name}_frames/
      // 별도 프레임 보관 디렉토리 (split이 train/val/test일 때만)
      ...(split && FRAME_SPLITS.includes(split) ? [path.join(framesBaseDir, split, `${lookupName}_frames`)] : []),
      path.join(framesBaseDir, `${lookupName}_frames`),
      path.join(targetDir, 'frames', lookupName),             // {dir}/frames/{name}/
      path.join(targetDir, lookupName, 'frames'),             // {dir}/{name}/frames/
      path.join(basePath, `${lookupName}_frames`),            // {basePath}/{name}_frames/ (split 무시)
      path.join(basePath, 'frames', lookupName),              // {basePath}/frames/{name}/
    ];
    
    // 존재하는 프레임 폴더 찾기
    for (const pattern of frameFolderPatterns) {
      if (fs.existsSync(pattern) && fs.statSync(pattern).isDirectory()) {
        framesDir = pattern;
        break;
      }
    }
    
    // LipReading_Dataset_Frames는 train/val/test만 사용 (landmark_samples 미사용). 재귀보다 먼저 시도
    if (!framesDir) {
      framesDir = findFramesFolderInSplitsOnly(framesBaseDir, `${lookupName}_frames`);
    }
    // 그다음 targetDir 재귀 (targetDir이 Frames 루트면 재귀 시 landmark_samples가 잡힐 수 있으므로 위에서 이미 시도함)
    if (!framesDir) {
      framesDir = findFramesFolderRecursive(targetDir, `${lookupName}_frames`);
      // 재귀 결과가 landmark_samples 안이면 사용하지 않고 null 유지 (train/val/test만 쓰기 위함)
      if (framesDir && framesDir.includes('landmark_samples')) {
        framesDir = null;
      }
    }
    // 기본 FRAMES_DIR에서도 시도 (framesBaseDir과 다른 경우)
    if (!framesDir && framesBaseDir !== FRAMES_DIR && fs.existsSync(FRAMES_DIR)) {
      framesDir = findFramesFolderInSplitsOnly(FRAMES_DIR, `${lookupName}_frames`);
    }
    // 우리 데이터셋 추론 결과(원본 파일명 stem) 시 D3/D4/D8 접두사 후보 시도
    if (!framesDir) {
      framesDir = findFramesDirWithPrefixes(lookupName, framesBaseDir, targetDir, basePath);
    }
  }
  
  if (!framesDir) {
    return NextResponse.json({ 
      error: 'Frames folder not found',
      searchedPaths: frameFolderPatterns,
      recursiveSearch: `${lookupName}_frames in ${targetDir}`,
    }, { status: 404 });
  }

  // 클립 로드 경로 로그 (landmark_samples 여부 확인용, 클립명당 1회만)
  const isLandmarkSamples = framesDir.includes('landmark_samples')
  if (!globalThis._framesPathLogged) globalThis._framesPathLogged = new Set()
  const logKey = `${lookupName}\0${framesDir}`
  if (!globalThis._framesPathLogged.has(logKey)) {
    globalThis._framesPathLogged.add(logKey)
    if (isLandmarkSamples) {
      console.warn(`[frames] WARNING 프레임 경로가 landmark_samples: name=${name} lookupName=${lookupName} framesDir=${framesDir}`)
    } else {
      console.log(`[frames] 프레임 제공 경로: name=${name} lookupName=${lookupName} framesDir=${framesDir}`)
    }
  }

  // 프레임 파일명 패턴 (다양한 패딩 지원)
  const framePatterns = [
    frameIndex.toString().padStart(4, '0'),  // 0000
    frameIndex.toString().padStart(5, '0'),  // 00000
    frameIndex.toString().padStart(6, '0'),  // 000000
    frameIndex.toString(),                    // 0 (패딩 없음)
  ];
  
  const extensions = ['.png', '.jpg', '.jpeg'];
  
  // 프레임 파일 찾기
  let framePath = null;
  let contentType = 'image/png';
  
  for (const frameBase of framePatterns) {
    for (const ext of extensions) {
      const testPath = path.join(framesDir, `${frameBase}${ext}`);
      if (fs.existsSync(testPath)) {
        framePath = testPath;
        contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
        break;
      }
    }
    if (framePath) break;
  }
  
  if (!framePath) {
    // 폴더 내 파일 목록으로 디버깅 정보 제공
    let filesInDir = [];
    try {
      filesInDir = fs.readdirSync(framesDir).slice(0, 10);
    } catch {}
    
    return NextResponse.json({ 
      error: 'Frame not found',
      framesDir,
      frameIndex,
      sampleFiles: filesInDir,
    }, { status: 404 });
  }
  
  try {
    const imageBuffer = fs.readFileSync(framePath);
    
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 1년 캐싱 (이미지는 변하지 않음)
      },
    });
  } catch (err) {
    console.error('Frame read error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * 프레임 폴더 정보 조회 (프레임 수 등)
 * POST /api/frames
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { basePath: rawBasePath = DEFAULT_DATASET_DIR, split = '', name, useLandmarks = false } = body;
    
    if (!name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    // _speakerN, _styleN 은 비디오/프레임 검색과 무관하므로 제거한 이름으로 조회
    const lookupName = clipNameForVideoLookup(name);
    
    // 프로젝트 루트에서 실제 디렉토리 자동 감지
    const basePath = resolveDataDir(rawBasePath);
    const framesBaseDir = resolveFramesDir(rawBasePath);
    
    const targetDir = split ? path.join(basePath, split) : basePath;
    
    let framesDir = null;
    
    // 랜드마크 모드: landmark_samples 우선 참조 (랜드마크가 찍힌 프레임), 없으면 train/val/test
    if (useLandmarks) {
      framesDir = findFramesDirInLandmarkSamples(framesBaseDir, lookupName);
      if (!framesDir) {
        framesDir = findFramesDirInSplits(framesBaseDir, lookupName, split || '');
      }
    }
    
    // 일반 프레임 또는 위에서 못 찾은 경우
    if (!framesDir) {
      // 프레임 폴더 찾기. LipReading_Dataset_Frames 하위는 train/val/test만 사용
      const frameFolderPatterns = [
        path.join(targetDir, `${lookupName}_frames`),
        ...(split && FRAME_SPLITS.includes(split) ? [path.join(framesBaseDir, split, `${lookupName}_frames`)] : []),
        path.join(framesBaseDir, `${lookupName}_frames`),
        path.join(targetDir, 'frames', lookupName),
        path.join(targetDir, lookupName, 'frames'),
        path.join(basePath, `${lookupName}_frames`),
        path.join(basePath, 'frames', lookupName),
      ];
      
      for (const pattern of frameFolderPatterns) {
        if (fs.existsSync(pattern) && fs.statSync(pattern).isDirectory()) {
          framesDir = pattern;
          break;
        }
      }
      
      // train/val/test 먼저 (landmark_samples 미사용)
      if (!framesDir) {
        framesDir = findFramesFolderInSplitsOnly(framesBaseDir, `${lookupName}_frames`);
      }
      if (!framesDir) {
        framesDir = findFramesFolderRecursive(targetDir, `${lookupName}_frames`);
        if (framesDir && framesDir.includes('landmark_samples')) framesDir = null;
      }
      if (!framesDir && framesBaseDir !== FRAMES_DIR && fs.existsSync(FRAMES_DIR)) {
        framesDir = findFramesFolderInSplitsOnly(FRAMES_DIR, `${lookupName}_frames`);
      }
      // 우리 데이터셋 추론 결과(원본 파일명 stem) 시 D3/D4/D8 접두사 후보 시도
      if (!framesDir) {
        framesDir = findFramesDirWithPrefixes(lookupName, framesBaseDir, targetDir, basePath);
      }
    }
    
    if (!framesDir) {
      return NextResponse.json({ 
        exists: false,
        frameCount: 0,
      });
    }
    
    // 프레임 파일 수 계산
    const files = fs.readdirSync(framesDir);
    const frameFiles = files.filter(f => 
      f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
    );
    
    return NextResponse.json({
      exists: true,
      framesDir,
      frameCount: frameFiles.length,
      sampleFiles: frameFiles.slice(0, 5),
    });
  } catch (err) {
    console.error('Frame info error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
