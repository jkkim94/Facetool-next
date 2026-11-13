import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { parseNpyFile } from '@/lib/server/parseNpy';

// 기본 데이터셋 경로 설정 (프로젝트 루트)
const DEFAULT_DATASET_DIR = 'E:\\DatasetGen';
const MP4_DIR = 'E:\\DatasetGen\\MP4';

const ALLOWED_FILE_ROOTS = [
  'E:\\DatasetGen',
  'e:\\DatasetGen',
  'E:/DatasetGen',
  'e:/DatasetGen',
];

function isAllowedAbsolutePath(resolvedPath) {
  const norm = path.resolve(resolvedPath).replace(/\//g, '\\').toLowerCase();
  return ALLOWED_FILE_ROOTS.some((root) => {
    const r = path.resolve(root).replace(/\//g, '\\').toLowerCase();
    return norm === r || norm.startsWith(`${r}\\`);
  });
}

function inferTypeFromPath(filePath, requestedType) {
  if (requestedType && requestedType !== 'auto') return requestedType;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.npy') return 'npy';
  if (ext === '.wav') return 'wav';
  if (ext === '.csv') return 'csv';
  if (ext === '.mp4') return 'mp4';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'image';
  return requestedType || 'csv';
}

// 알려진 하위 디렉토리 패턴
const DATA_SUBDIRS = ['LipReading_Dataset_Video', 'LipReading_Dataset_Synced'];

/**
 * 프로젝트 루트 경로에서 실제 데이터 디렉토리를 자동 감지합니다.
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

  return basePath;
}


/**
 * 재귀적으로 파일을 찾습니다.
 * @param {string} dir - 검색할 디렉토리
 * @param {string} filename - 찾을 파일명
 * @param {number} maxDepth - 최대 탐색 깊이
 * @param {number} currentDepth - 현재 깊이
 * @returns {string|null} - 찾은 파일의 전체 경로 또는 null
 */
function findFileRecursive(dir, filename, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;
  
  try {
    if (!fs.existsSync(dir)) return null;
    
    // 먼저 현재 디렉토리에서 직접 찾기
    const directPath = path.join(dir, filename);
    if (fs.existsSync(directPath)) {
      return directPath;
    }
    
    // 하위 디렉토리 탐색
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory() && !item.name.endsWith('_frames')) {
        const found = findFileRecursive(path.join(dir, item.name), filename, maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch (err) {
    console.error('Error searching file:', dir, err.message);
  }
  
  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const absolutePathParam = searchParams.get('absolutePath');
    const rawBasePath = searchParams.get('basePath') || DEFAULT_DATASET_DIR;
    const split = searchParams.get('split') || '';
    const name = searchParams.get('name');
    const type = searchParams.get('type') || 'csv'; // csv, wav, mp4, npy
    const fileDirParam = searchParams.get('fileDir'); // 직접 지정된 파일 디렉토리

    // 절대 경로 직접 지정 (목록 스캔 없음)
    if (absolutePathParam) {
      const resolved = path.resolve(absolutePathParam);
      if (!isAllowedAbsolutePath(resolved)) {
        return NextResponse.json({ error: 'Path not allowed', path: resolved }, { status: 403 });
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return NextResponse.json({ error: 'File not found', path: resolved }, { status: 404 });
      }

      const resolvedType = inferTypeFromPath(resolved, type);
      const featureDir = path.dirname(resolved);
      let contentType;

      if (resolvedType === 'csv') {
        const content = fs.readFileSync(resolved, 'utf-8');
        return new NextResponse(content, {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }
      if (resolvedType === 'npy') {
        const npyData = parseNpyFile(resolved, featureDir);
        return NextResponse.json(npyData);
      }
      if (resolvedType === 'wav') contentType = 'audio/wav';
      else if (resolvedType === 'mp4') contentType = 'video/mp4';
      else if (resolvedType === 'image') {
        const ext = path.extname(resolved).toLowerCase();
        contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        const stats = fs.statSync(resolved);
        const buffer = fs.readFileSync(resolved);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': stats.size.toString(),
          },
        });
      } else {
        return NextResponse.json({ error: 'Invalid type for absolutePath' }, { status: 400 });
      }

      const stats = fs.statSync(resolved);
      const range = request.headers.get('range');
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(resolved, { start, end });
        return new NextResponse(stream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Content-Type': contentType,
          },
        });
      }
      const buffer = fs.readFileSync(resolved);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': stats.size.toString(),
        },
      });
    }
    
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    
    // 프로젝트 루트에서 실제 데이터 디렉토리 자동 감지
    const basePath = resolveDataDir(rawBasePath);
    
    // 타겟 디렉토리 결정
    const targetDir = split ? path.join(basePath, split) : basePath;
    
    let filePath;
    let contentType;
    
    if (type === 'csv') {
      // 먼저 직접 경로 확인, 없으면 재귀 검색
      const directPath = fileDirParam ? path.join(fileDirParam, `${name}.csv`) : path.join(targetDir, `${name}.csv`);
      filePath = fs.existsSync(directPath) ? directPath : findFileRecursive(targetDir, `${name}.csv`);
      contentType = 'text/csv';
    } else if (type === 'npy') {
      const directPath = fileDirParam ? path.join(fileDirParam, `${name}.npy`) : path.join(targetDir, `${name}.npy`);
      filePath = fs.existsSync(directPath) ? directPath : findFileRecursive(targetDir, `${name}.npy`);
      contentType = 'application/json'; // NPY는 JSON으로 변환하여 반환
    } else if (type === 'wav') {
      const directPath = fileDirParam ? path.join(fileDirParam, `${name}.wav`) : path.join(targetDir, `${name}.wav`);
      filePath = fs.existsSync(directPath) ? directPath : findFileRecursive(targetDir, `${name}.wav`);
      contentType = 'audio/wav';
    } else if (type === 'mp4') {
      // MP4는 원본 폴더에서 찾아야 함 (프로젝트 루트에서 MP4 폴더 자동 감지)
      filePath = findMp4(name, rawBasePath);
      contentType = 'video/mp4';
    } else if (type === 'image' || type === 'png' || type === 'jpg') {
      // 랜드마크 샘플 등 이미지: fileDir + name (확장자 포함)
      if (!fileDirParam) {
        return NextResponse.json({ error: 'fileDir required for image type' }, { status: 400 });
      }
      const nameWithExt = name.includes('.') ? name : `${name}.${type === 'jpg' ? 'jpg' : 'png'}`;
      filePath = path.join(fileDirParam, nameWithExt);
      const ext = path.extname(filePath).toLowerCase();
      contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
    
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found', name, type, searchDir: targetDir }, { status: 404 });
    }

    // 이미지는 바이너리 반환
    if (type === 'image' || type === 'png' || type === 'jpg') {
      const stats = fs.statSync(filePath);
      const buffer = fs.readFileSync(filePath);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': stats.size.toString(),
        },
      });
    }
    
    // CSV는 텍스트로 반환
    if (type === 'csv') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
        },
      });
    }
    
    // NPY는 JSON으로 변환하여 반환
    if (type === 'npy') {
      const npyData = parseNpyFile(filePath, basePath);
      return NextResponse.json(npyData);
    }
    
    // WAV, MP4는 스트리밍
    const stats = fs.statSync(filePath);
    const range = request.headers.get('range');
    
    if (range) {
      // Range 요청 처리 (비디오/오디오 스트리밍)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunkSize = end - start + 1;
      
      const stream = fs.createReadStream(filePath, { start, end });
      
      return new NextResponse(stream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType,
        },
      });
    } else {
      const buffer = fs.readFileSync(filePath);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': stats.size.toString(),
        },
      });
    }
  } catch (error) {
    console.error('Error reading file:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// MP4 파일 찾기 (재귀 검색, 프로젝트 루트에서 MP4 폴더 자동 감지)
function findMp4(name, projectRoot) {
  const searchDirs = [
    path.join(MP4_DIR, 'F(여성)'),
    path.join(MP4_DIR, 'M(남성)'),
    MP4_DIR,
  ];
  
  // 프로젝트 루트에서 MP4 폴더도 탐색
  if (projectRoot && projectRoot !== MP4_DIR) {
    const mp4InProject = path.join(projectRoot, 'MP4');
    if (fs.existsSync(mp4InProject) && !searchDirs.includes(mp4InProject)) {
      searchDirs.push(path.join(mp4InProject, 'F(여성)'));
      searchDirs.push(path.join(mp4InProject, 'M(남성)'));
      searchDirs.push(mp4InProject);
    }
  }
  
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
