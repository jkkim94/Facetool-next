'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// 기본 데이터셋 경로 (프로젝트 루트 - 하위 디렉토리 자동 감지)
const DEFAULT_BASE_PATH = 'E:\\DatasetGen';

/** 동일 stem이 서로 다른 폴더에 있을 때 React key 충돌 방지 */
function getFileKey(file, index = 0) {
  if (file.id) return file.id;
  if (file.fullPath) return `${file.fullPath}::${file.name}`;
  return `${file.name}::${index}`;
}

export default function FileBrowser({
  onFileSelect,
  onBasePathChange,
  initialBasePath,
  autoLoad = true,
  fastList = false,
  includeFrames = true,
}) {
  const [basePath, setBasePath] = useState(initialBasePath || DEFAULT_BASE_PATH);
  const [basePathInput, setBasePathInput] = useState(initialBasePath || DEFAULT_BASE_PATH);
  const [currentSplit, setCurrentSplit] = useState('');
  const [hasSplitStructure, setHasSplitStructure] = useState(false);
  const [files, setFiles] = useState([]);
  const [splits, setSplits] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFileKey, setSelectedFileKey] = useState(null);
  const [selectedFileLabel, setSelectedFileLabel] = useState(null);
  const [landmarkOnly, setLandmarkOnly] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pathInputRef = useRef(null);

  const [loadedOnce, setLoadedOnce] = useState(false);

  // 파일 목록 로드
  const loadFiles = useCallback(async (path, split) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('basePath', path);
      if (split) params.set('split', split);
      if (fastList) {
        params.set('fast', '1');
        params.set('frames', '0');
        params.set('splitCounts', '0');
      } else if (!includeFrames) {
        params.set('frames', '0');
      }
      
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to load files');
      }
      const data = await res.json();
      setFiles(data.files || []);
      setSplits(data.splits);
      setHasSplitStructure(data.hasSplitStructure || false);
      if (data.split !== undefined) {
        setCurrentSplit(data.split);
      }
      // API에서 resolve된 실제 데이터 경로가 있으면 사용
      if (data.basePath && data.basePath !== path) {
        console.log(`[FileBrowser] Auto-resolved: ${path} -> ${data.basePath}`);
      }
      setLoadedOnce(true);
    } catch (err) {
      setError(err.message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [fastList, includeFrames]);

  // basePath / split 변경 시 — autoLoad 또는 이미 조회한 적 있을 때만
  useEffect(() => {
    if (!autoLoad && !loadedOnce) return;
    loadFiles(basePath, currentSplit);
  }, [basePath, currentSplit, loadFiles, autoLoad, loadedOnce]);

  useEffect(() => {
    if (initialBasePath && initialBasePath !== basePath) {
      setBasePath(initialBasePath);
      setBasePathInput(initialBasePath);
      setCurrentSplit('');
      setPage(0);
      setLoadedOnce(false);
      if (onBasePathChange) onBasePathChange(initialBasePath);
    }
  }, [initialBasePath]);

  // 경로 적용 핸들러
  const handleApplyPath = () => {
    const trimmedPath = basePathInput.trim();
    if (trimmedPath && trimmedPath !== basePath) {
      setBasePath(trimmedPath);
      setCurrentSplit('');
      setPage(0);
      setLoadedOnce(true);
      if (onBasePathChange) {
        onBasePathChange(trimmedPath);
      }
    } else if (trimmedPath) {
      setLoadedOnce(true);
      loadFiles(trimmedPath, currentSplit);
    }
  };

  // Enter 키로 경로 적용
  const handlePathKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleApplyPath();
    }
  };

  // 파일 필터링
  const filteredFiles = files.filter(f => {
    if (landmarkOnly && !f.hasLandmarks) return false;
    return f.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // 페이지네이션
  const totalPages = Math.ceil(filteredFiles.length / pageSize);
  const pagedFiles = filteredFiles.slice(page * pageSize, (page + 1) * pageSize);

  // 파일 선택 핸들러
  const handleFileDoubleClick = (file, fileKey) => {
    setSelectedFileKey(fileKey);
    setSelectedFileLabel(file.fullPath ? `${file.name} (${file.fullPath})` : file.name);
    if (onFileSelect) {
      // basePath와 split을 포함한 URL 생성
      const baseParams = `basePath=${encodeURIComponent(basePath)}${currentSplit ? `&split=${currentSplit}` : ''}`;
      
      // 파일 디렉토리 정보 추가 (재귀 검색 결과에서 fullPath가 있으면 사용)
      const fileDirParam = file.fullPath ? `&fileDir=${encodeURIComponent(file.fullPath)}` : '';
      
      // 데이터 타입 결정 (NPY 우선, 없으면 CSV)
      const dataType = file.hasNpy ? 'npy' : 'csv';
      
      onFileSelect({
        name: file.name,
        basePath,
        split: currentSplit,
        fullPath: file.fullPath, // 실제 파일 위치
        hasNpy: file.hasNpy,
        hasCsv: file.hasCsv,
        hasWav: file.hasWav,
        hasFrames: file.hasFrames,
        frameCount: file.frameCount,
        hasLandmarks: file.hasLandmarks,
        landmarkCount: file.landmarkCount,
        useLandmarks: landmarkOnly, // 랜드마크 필터가 켜져있으면 랜드마크 프레임 모드로 전달
        // URL 생성 (fullPath 정보 포함)
        dataUrl: `/api/file?${baseParams}${fileDirParam}&name=${encodeURIComponent(file.name)}&type=${dataType}`,
        csvUrl: file.hasCsv ? `/api/file?${baseParams}${fileDirParam}&name=${encodeURIComponent(file.name)}&type=csv` : null,
        npyUrl: file.hasNpy ? `/api/file?${baseParams}${fileDirParam}&name=${encodeURIComponent(file.name)}&type=npy` : null,
        wavUrl: file.hasWav ? `/api/file?${baseParams}${fileDirParam}&name=${encodeURIComponent(file.name)}&type=wav` : null,
        mp4Url: `/api/file?${baseParams}${fileDirParam}&name=${encodeURIComponent(file.name)}&type=mp4`,
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-200 text-xs">
      {/* 헤더 */}
      <div className="p-2 bg-gray-800 border-b border-gray-700">
        <h3 className="font-semibold text-sm mb-2">Dataset Browser</h3>
        
        {/* 폴더 경로 입력 */}
        <div className="mb-2">
          <label className="block text-[10px] text-gray-400 mb-1">Dataset Path:</label>
          <div className="flex gap-1">
            <input
              ref={pathInputRef}
              type="text"
              value={basePathInput}
              onChange={(e) => setBasePathInput(e.target.value)}
              onKeyDown={handlePathKeyDown}
              placeholder="E:\DatasetGen\..."
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={handleApplyPath}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium"
            >
              {autoLoad ? 'Load' : '조회'}
            </button>
          </div>
        </div>
        
        {/* Split 탭 (split 구조가 있는 경우만 표시) */}
        {hasSplitStructure && splits && (
          <div className="grid grid-cols-3 gap-1 mb-2">
            {['train', 'val', 'test'].map((split) => (
              <button
                key={split}
                type="button"
                onClick={() => { setCurrentSplit(split); setPage(0); setLoadedOnce(true); }}
                className={`px-1 py-1.5 rounded text-[10px] font-medium text-center truncate ${
                  currentSplit === split
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title={`${split}${splits[split] != null ? ` (${splits[split]})` : ''}`}
              >
                {split}
                {splits[split] != null ? ` (${splits[split]})` : ''}
              </button>
            ))}
          </div>
        )}

        {/* 검색 */}
        <input
          type="text"
          placeholder="Search files..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {/* 랜드마크 필터 */}
        <label className="flex items-center gap-1.5 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={landmarkOnly}
            onChange={(e) => { setLandmarkOnly(e.target.checked); setPage(0); }}
            className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-yellow-500 focus:ring-yellow-500 focus:ring-1 cursor-pointer"
          />
          <span className={`text-[10px] ${landmarkOnly ? 'text-yellow-400 font-medium' : 'text-gray-400'}`}>
            Landmark Frames Only
          </span>
        </label>
      </div>

      {/* 파일 목록 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : error ? (
          <div className="p-4 text-center text-red-400">{error}</div>
        ) : !loadedOnce && !autoLoad ? (
          <div className="p-4 text-center text-gray-500">
            경로 확인 후 「조회」를 누르세요
          </div>
        ) : pagedFiles.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No files found</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {pagedFiles.map((file, idx) => {
              const fileKey = getFileKey(file, page * pageSize + idx);
              return (
              <div
                key={fileKey}
                onDoubleClick={() => handleFileDoubleClick(file, fileKey)}
                className={`px-2 py-1.5 cursor-pointer hover:bg-gray-800 ${
                  selectedFileKey === fileKey ? 'bg-blue-900 bg-opacity-50' : ''
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 w-6 text-right text-[10px]">{page * pageSize + idx + 1}</span>
                  <span className="truncate flex-1" title={file.fullPath ? `${file.name}\n${file.fullPath}` : file.name}>
                    {file.name}
                  </span>
                  {/* 파일 타입 배지 */}
                  <div className="flex gap-0.5">
                    {file.hasNpy && (
                      <span className="text-purple-400 text-[9px] px-1 bg-purple-900 bg-opacity-50 rounded">NPY</span>
                    )}
                    {file.hasCsv && (
                      <span className="text-blue-400 text-[9px] px-1 bg-blue-900 bg-opacity-50 rounded">CSV</span>
                    )}
                    {file.hasWav && (
                      <span className="text-green-400 text-[9px] px-1 bg-green-900 bg-opacity-50 rounded">WAV</span>
                    )}
                    {file.hasFrames && (
                      <span className="text-yellow-400 text-[9px] px-1 bg-yellow-900 bg-opacity-50 rounded">
                        {file.frameCount || 'PNG'}
                      </span>
                    )}
                    {file.hasLandmarks && (
                      <span className="text-orange-400 text-[9px] px-1 bg-orange-900 bg-opacity-50 rounded">
                        LM
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="p-2 bg-gray-800 border-t border-gray-700 flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
          >
            Prev
          </button>
          <span className="text-gray-400">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
          >
            Next
          </button>
        </div>
      )}

      {/* 선택된 파일 정보 */}
      {selectedFileLabel && (
        <div className="p-2 bg-gray-800 border-t border-gray-700">
          <div className="text-[10px] text-gray-400">Selected:</div>
          <div className="text-xs text-blue-400 truncate" title={selectedFileLabel}>
            {selectedFileLabel}
          </div>
        </div>
      )}
      
      {/* 총 파일 수 */}
      <div className="p-2 bg-gray-800 border-t border-gray-700 text-[10px] text-gray-500">
        Total: {filteredFiles.length} files
        {hasSplitStructure && currentSplit && ` (${currentSplit})`}
      </div>
    </div>
  );
}
