'use client'

export const DEFAULT_MODEL_TRANSFORM = {
  x: -0.15,
  y: 0.0,
  z: 4.49,
  scale: 1.0,
  rx: 0.02,
  ry: 0.2,
  rz: 0.0,
}

/**
 * 3D 아바타 위치/스케일/회전 조절 패널 (DatasetViewer 등과 동일 UX)
 */
export default function ModelTransformPanel({
  transform,
  onChange,
  storageKey,
  onClose,
  className = 'absolute top-12 right-2 z-30',
}) {
  const set = (patch) => onChange((prev) => ({ ...prev, ...patch }))

  const handleSave = () => {
    if (!storageKey) {
      alert('storageKey가 없어 저장할 수 없습니다.')
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(transform))
      alert('Transform 저장 완료')
    } catch {
      alert('저장 실패')
    }
  }

  const handleCopy = () => {
    const values = `Position: [${transform.x.toFixed(2)}, ${transform.y.toFixed(2)}, ${transform.z.toFixed(2)}], Scale: ${transform.scale.toFixed(2)}, Rotation: [${transform.rx.toFixed(2)}, ${transform.ry.toFixed(2)}, ${transform.rz.toFixed(2)}]`
    navigator.clipboard.writeText(values)
    alert('값 복사됨')
  }

  return (
    <div className={`${className} bg-gray-900/95 text-white px-3 py-2 rounded-lg text-xs w-60 border border-white/10 shadow-xl`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">Model Transform</span>
        {onClose && (
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            x
          </button>
        )}
      </div>
      {[
        { key: 'x', label: 'X', color: 'text-blue-400', min: -10, max: 10 },
        { key: 'y', label: 'Y', color: 'text-green-400', min: -10, max: 10 },
        { key: 'z', label: 'Z', color: 'text-yellow-400', min: -10, max: 10 },
      ].map(({ key, label, color, min, max }) => (
        <div key={`pos-${key}`} className="mb-1">
          <div className="flex justify-between items-center gap-1">
            <span className="text-gray-400 whitespace-nowrap">Pos {label}</span>
            <input
              type="number"
              step="0.01"
              value={transform[key]}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) set({ [key]: v })
              }}
              className={`w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded ${color} focus:border-blue-400 outline-none`}
            />
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step="0.01"
            value={transform[key]}
            onChange={(e) => set({ [key]: parseFloat(e.target.value) })}
            className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer"
          />
        </div>
      ))}
      <div className="mb-1">
        <div className="flex justify-between items-center gap-1">
          <span className="text-gray-400">Scale</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={transform.scale}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v) && v > 0) set({ scale: v })
            }}
            className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-purple-400 focus:border-blue-400 outline-none"
          />
        </div>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.01"
          value={transform.scale}
          onChange={(e) => set({ scale: parseFloat(e.target.value) })}
          className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer"
        />
      </div>
      {[
        { key: 'rx', label: 'X' },
        { key: 'ry', label: 'Y' },
        { key: 'rz', label: 'Z' },
      ].map(({ key, label }) => (
        <div key={`rot-${key}`} className="mb-1">
          <div className="flex justify-between items-center gap-1">
            <span className="text-gray-400">Rot {label}</span>
            <input
              type="number"
              step="0.01"
              value={transform[key]}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) set({ [key]: v })
              }}
              className="w-20 px-1 py-0.5 text-right font-mono text-[11px] bg-black/60 border border-gray-600 rounded text-orange-400 focus:border-blue-400 outline-none"
            />
          </div>
          <input
            type="range"
            min="-3.14"
            max="3.14"
            step="0.01"
            value={transform[key]}
            onChange={(e) => set({ [key]: parseFloat(e.target.value) })}
            className="w-full h-1 bg-gray-700 rounded appearance-none cursor-pointer"
          />
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_MODEL_TRANSFORM)}
          className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-white"
        >
          기본값 복원
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="w-full px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white"
        >
          저장
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="w-full px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          값 복사
        </button>
      </div>
    </div>
  )
}
