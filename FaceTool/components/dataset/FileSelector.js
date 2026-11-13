'use client';

export default function FileSelector({ 
  videoFile, 
  glbFile, 
  onVideoSelect, 
  onGlbSelect, 
  disabled 
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 mb-4 flex-shrink-0">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-semibold text-gray-200 mb-2">
            비디오 파일 (필수)
          </label>
          <input
            type="file"
            accept="video/*"
            onChange={onVideoSelect}
            disabled={disabled}
            className="w-full text-sm bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
          />
          {videoFile && (
            <p className="mt-1 text-xs text-gray-300">
              선택됨: {videoFile.name}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            권장: H.264(AVC) MP4. 해상도는 4의 배수(예: 532x532). HEVC/H.265 미지원.
          </p>
        </div>

        <div className="flex-1">
          <label className="block text-sm font-semibold text-gray-200 mb-2">
            3D 모델 GLB 파일 (선택, 기본: face.glb)
          </label>
          <input
            type="file"
            accept=".glb"
            onChange={onGlbSelect}
            disabled={disabled}
            className="w-full text-sm bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
          />
          {glbFile && (
            <p className="mt-1 text-xs text-gray-300">
              선택됨: {glbFile.name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
