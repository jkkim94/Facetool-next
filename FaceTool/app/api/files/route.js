import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 기본 데이터셋 경로 설정 (프로젝트 루트)
const DEFAULT_DATASET_DIR = 'E:\\DatasetGen';

// 알려진 하위 디렉토리 패턴
const DATA_SUBDIRS = ['LipReading_Dataset_Video', 'LipReading_Dataset_Synced'];

/**
 * 프로젝트 루트 경로에서 실제 데이터 디렉토리를 자동 감지합니다.
 * 예: E:\DatasetGen -> E:\DatasetGen\LipReading_Dataset_Video
 * 이미 데이터 디렉토리를 직접 가리키는 경우 그대로 반환합니다.
 */
function resolveDataDir(basePath) {
  // 이미 train/val/test 구조가 있으면 그대로 사용
  const hasSplitDirect = ['train', 'val', 'test'].some(s => {
    const p = path.join(basePath, s);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  });
  if (hasSplitDirect) return basePath;

  // 이미 npy/wav 파일이 직접 있으면 그대로 사용
  try {
    const items = fs.readdirSync(basePath);
    const hasDataFiles = items.some(f => f.endsWith('.npy') || f.endsWith('.csv') || f.endsWith('.wav'));
    if (hasDataFiles) return basePath;
  } catch {}

  // 알려진 하위 데이터 디렉토리 탐색
  for (const subdir of DATA_SUBDIRS) {
    const candidate = path.join(basePath, subdir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // 찾지 못하면 원래 경로 반환
  return basePath;
}

/**
 * 재귀적으로 디렉토리를 탐색하여 NPY/CSV/WAV 파일을 찾습니다.
 * @param {string} dir - 탐색할 디렉토리
 * @param {Map} fileMap - 파일 정보를 저장할 Map
 * @param {number} maxDepth - 최대 탐색 깊이
 * @param {number} currentDepth - 현재 깊이
 */
function scanDirectoryRecursive(dir, fileMap, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) return;
  
  try {
    if (!fs.existsSync(dir)) return;
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        // _frames 폴더는 스킵 (프레임 이미지 폴더)
        if (!item.name.endsWith('_frames')) {
          scanDirectoryRecursive(fullPath, fileMap, maxDepth, currentDepth + 1);
        }
      } else {
        const ext = path.extname(item.name).toLowerCase();
        if (ext === '.npy' || ext === '.csv' || ext === '.wav') {
          const stem = path.basename(item.name, ext);
          const parentDir = path.dirname(fullPath);
          
          // 키는 "상대경로:파일명"으로 구성하여 중복 방지
          const key = `${parentDir}:${stem}`;
          
          if (!fileMap.has(key)) {
            fileMap.set(key, {
              name: stem,
              fullPath: parentDir,
              hasCsv: false,
              hasNpy: false,
              hasWav: false,
              hasFrames: false,
              frameCount: 0,
            });
          }
          
          const entry = fileMap.get(key);
          if (ext === '.csv') entry.hasCsv = true;
          if (ext === '.npy') entry.hasNpy = true;
          if (ext === '.wav') entry.hasWav = true;
        }
      }
    }
  } catch (err) {
    console.error('Error scanning directory:', dir, err.message);
  }
}

// 프레임 보관 디렉토리 (데이터와 별도 보관)
const FRAMES_DIR = 'E:\\DatasetGen\\LipReading_Dataset_Frames';
const FRAME_SUBDIRS = ['LipReading_Dataset_Frames'];

/**
 * 프로젝트 루트에서 프레임 디렉토리를 찾습니다.
 */
function resolveFramesDir(basePath) {
  if (fs.existsSync(FRAMES_DIR)) return FRAMES_DIR;
  for (const subdir of FRAME_SUBDIRS) {
    const candidate = path.join(basePath, subdir);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return FRAMES_DIR;
}

const FRAME_SPLITS = ['train', 'val', 'test'];
const LANDMARK_SAMPLES_DIR = 'landmark_samples';

/** dev 응답 지연 완화 — 동일 basePath/split 짧은 TTL 캐시 */
const listCache = new Map();
const LIST_CACHE_TTL_MS = 30_000;

function listCacheGet(key) {
  const hit = listCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LIST_CACHE_TTL_MS) {
    listCache.delete(key);
    return null;
  }
  return hit.body;
}

function listCacheSet(key, body) {
  listCache.set(key, { at: Date.now(), body });
  if (listCache.size > 40) {
    const oldest = listCache.keys().next().value;
    listCache.delete(oldest);
  }
}

function scanFramesInDir(parentDir) {
  const result = new Map();
  try {
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) return result;
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.endsWith('_frames')) {
        const name = e.name.replace(/_frames$/, '');
        const fullPath = path.join(parentDir, e.name);
        try {
          const frames = fs.readdirSync(fullPath).filter(f =>
            f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
          );
          if (frames.length > 0) {
            result.set(name, { count: frames.length, path: fullPath });
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return result;
}

/**
 * landmark_samples 우선, 그 다음 train/val/test 스캔하여 {name}_frames Map 반환.
 * landmark_samples = 랜드마크가 찍힌 프레임 (우선 사용)
 */
function scanSplitFrames(framesBaseDir) {
  const result = new Map();
  // 1) landmark_samples 먼저 스캔 (랜드마크 오버레이된 프레임)
  const landmarkDir = path.join(framesBaseDir, LANDMARK_SAMPLES_DIR);
  const landmarkMap = scanFramesInDir(landmarkDir);
  for (const [name, info] of landmarkMap) {
    result.set(name, info);
  }
  // 2) train/val/test 스캔 (이미 있으면 landmark_samples 우선이므로 스킵)
  for (const split of FRAME_SPLITS) {
    const splitDir = path.join(framesBaseDir, split);
    const splitMap = scanFramesInDir(splitDir);
    for (const [name, info] of splitMap) {
      if (!result.has(name)) result.set(name, info);
    }
  }
  return result;
}

/**
 * 프레임 폴더 정보를 업데이트합니다.
 * 데이터 파일 위치와 별도 프레임 보관 디렉토리 모두 확인합니다.
 * train/val/test 디렉토리에서 프레임 존재 여부도 확인합니다.
 */
function updateFrameInfo(fileMap, rawBasePath, currentSplit) {
  const framesBaseDir = resolveFramesDir(rawBasePath);
  
  // train/val/test 한 번만 스캔 (O(1) 조회)
  const landmarkMap = scanSplitFrames(framesBaseDir);
  
  for (const [key, entry] of fileMap) {
    // 일반 프레임 확인
    const frameFolderPatterns = [
      // 데이터 파일과 같은 위치
      path.join(entry.fullPath, `${entry.name}_frames`),
      path.join(entry.fullPath, 'frames', entry.name),
      // 별도 프레임 보관 디렉토리 (split 포함)
      ...(currentSplit ? [path.join(framesBaseDir, currentSplit, `${entry.name}_frames`)] : []),
      // 별도 프레임 보관 디렉토리 (split 없이)
      path.join(framesBaseDir, `${entry.name}_frames`),
    ];
    
    for (const fp of frameFolderPatterns) {
      try {
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
          const frames = fs.readdirSync(fp).filter(f => 
            f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
          );
          entry.hasFrames = true;
          entry.frameCount = frames.length;
          entry.framesPath = fp;
          break;
        }
      } catch {
        // ignore
      }
    }

    // 랜드마크 프레임: 미리 스캔한 Map에서 조회
    // 1) 정확히 일치 (entry.name === landmark key)
    // 2) 세그먼트 접미사 제거 후 조회 (lip_..._001_009 -> lip_..._001)
    let lm = landmarkMap.get(entry.name);
    if (!lm) {
      const prefixMatch = entry.name.match(/^(.+)_\d+$/);
      if (prefixMatch) {
        lm = landmarkMap.get(prefixMatch[1]);
      }
    }
    entry.hasLandmarks = !!lm;
    entry.landmarkCount = lm ? lm.count : 0;
    if (lm) entry.landmarkPath = lm.path;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawBasePath = searchParams.get('basePath') || DEFAULT_DATASET_DIR;
    const split = searchParams.get('split') || '';
    const fast = searchParams.get('fast') === '1';
    const includeFrames = searchParams.get('frames') !== '0';
    const includeSplitCounts = searchParams.get('splitCounts') === '1';

    const cacheKey = `${rawBasePath}|${split}|${fast}|${includeFrames}|${includeSplitCounts}`;
    const cached = listCacheGet(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
    
    // basePath가 존재하는지 확인
    if (!fs.existsSync(rawBasePath)) {
      return NextResponse.json({ error: 'Base path not found', basePath: rawBasePath }, { status: 404 });
    }
    
    // 프로젝트 루트에서 실제 데이터 디렉토리 자동 감지
    const basePath = resolveDataDir(rawBasePath);
    
    // 폴더 구조 감지: train/val/test가 있는지 확인
    const hasSplitStructure = ['train', 'val', 'test'].some(s => 
      fs.existsSync(path.join(basePath, s)) && fs.statSync(path.join(basePath, s)).isDirectory()
    );
    
    let targetDir;
    let currentSplit = split;
    
    if (hasSplitStructure) {
      // train/val/test 구조가 있는 경우
      currentSplit = split || 'train';
      targetDir = path.join(basePath, currentSplit);
      if (!fs.existsSync(targetDir)) {
        // 요청한 split이 없으면 존재하는 첫 번째 split 사용
        for (const s of ['train', 'val', 'test']) {
          const testPath = path.join(basePath, s);
          if (fs.existsSync(testPath)) {
            currentSplit = s;
            targetDir = testPath;
            break;
          }
        }
      }
    } else {
      // 플랫 구조 (train/val/test 없음) - 재귀적으로 검색
      targetDir = basePath;
      currentSplit = '';
    }
    
    if (!fs.existsSync(targetDir)) {
      return NextResponse.json({ error: 'Target directory not found' }, { status: 404 });
    }
    
    // 파일 검색 — split 폴더는 1-depth(클립 파일)만, flat/fast는 재귀 생략
    const fileMap = new Map();
    const scanDepth = hasSplitStructure ? 1 : (fast ? 2 : 10);
    scanDirectoryRecursive(targetDir, fileMap, scanDepth);
    
    if (includeFrames) {
      updateFrameInfo(fileMap, rawBasePath, currentSplit);
    }
    
    // 결과 정리: NPY 또는 CSV가 있는 파일만 (랜드마크는 동일 파일의 프레임 경로만 다름)
    const files = Array.from(fileMap.entries())
      .map(([id, f]) => ({ ...f, id }))
      .filter(f => f.hasNpy || f.hasCsv)
      .sort((a, b) => a.name.localeCompare(b.name) || (a.fullPath || '').localeCompare(b.fullPath || ''));
    
    let splits = null;
    if (hasSplitStructure) {
      if (includeSplitCounts) {
        splits = {
          train: countFilesRecursive(path.join(basePath, 'train'), 1),
          val: countFilesRecursive(path.join(basePath, 'val'), 1),
          test: countFilesRecursive(path.join(basePath, 'test'), 1),
        };
      } else {
        splits = {
          train: currentSplit === 'train' ? files.length : null,
          val: currentSplit === 'val' ? files.length : null,
          test: currentSplit === 'test' ? files.length : null,
        };
      }
    }
    
    const body = {
      basePath,
      rawBasePath,
      split: currentSplit,
      hasSplitStructure,
      files,
      total: files.length,
      splits,
    };
    listCacheSet(cacheKey, body);

    return NextResponse.json(body);
  } catch (error) {
    console.error('Error listing files:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function countFilesRecursive(dir, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) return 0;
  
  try {
    if (!fs.existsSync(dir)) return 0;
    
    let count = 0;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const stems = new Set();
    
    for (const item of items) {
      if (item.isDirectory()) {
        if (!item.name.endsWith('_frames')) {
          count += countFilesRecursive(path.join(dir, item.name), maxDepth, currentDepth + 1);
        }
      } else {
        const ext = path.extname(item.name).toLowerCase();
        if (ext === '.csv' || ext === '.npy') {
          stems.add(path.basename(item.name, ext));
        }
      }
    }
    
    return count + stems.size;
  } catch {
    return 0;
  }
}
