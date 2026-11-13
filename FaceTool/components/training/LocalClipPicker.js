'use client'

import { useRef, useState, useCallback } from 'react'
import {
  classifyClipFiles,
  pairClipFiles,
} from '@/lib/eval/localClipPaths'

function FilePickButton({ label, accept, fileName, onPick, disabled, accent = 'cyan' }) {
  const inputRef = useRef(null)
  const accentClass =
    accent === 'green'
      ? 'bg-green-700 hover:bg-green-600'
      : 'bg-cyan-700 hover:bg-cyan-600'

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`w-full px-3 py-1.5 ${accentClass} disabled:bg-gray-600 text-white rounded text-xs font-medium`}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.target.value = ''
        }}
      />
      <p className="mt-0.5 text-[10px] text-gray-500 truncate" title={fileName || ''}>
        {fileName || '—'}
      </p>
    </div>
  )
}

export default function LocalClipPicker({
  expectedOutputKind = null,
  outputKindLabel = (k) => k,
  onFilesDrop,
  npyLoading = false,
  npyFileName = '',
  wavFileName = '',
  npyAutoFound = false,
  wavAutoFound = false,
}) {
  const [dragOver, setDragOver] = useState(false)

  const dispatchFiles = useCallback(
    (fileList) => {
      const { npyFiles, wavFiles } = classifyClipFiles(Array.from(fileList))
      const pair = pairClipFiles(npyFiles, wavFiles)
      if (!pair.npyFile && !pair.wavFile) return
      onFilesDrop?.(pair)
    },
    [onFilesDrop],
  )

  const onDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const onDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (npyLoading) return
    if (e.dataTransfer?.files?.length) dispatchFiles(e.dataTransfer.files)
  }

  const npyLabel = npyAutoFound
    ? `${npyFileName} (자동)`
    : npyFileName
  const wavLabel = wavAutoFound
    ? `${wavFileName} (자동)`
    : wavFileName

  return (
    <div className="space-y-2">
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-3 text-center transition-colors ${
          dragOver
            ? 'border-cyan-400 bg-cyan-500/10'
            : 'border-gray-600 bg-gray-900/40'
        } ${npyLoading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <p className="text-xs text-gray-300 font-medium">NPY / WAV 드래그 앤 드롭</p>
        <p className="text-[10px] text-gray-500 mt-1 leading-snug">
          같은 이름(stem)이면 자동 페어링 · WAV만 넣어도 GT NPY 자동 로드
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FilePickButton
          label={npyLoading ? '로드 중…' : 'NPY'}
          accept=".npy"
          fileName={npyLabel}
          onPick={(file) => onFilesDrop?.(pairClipFiles([file], []))}
          disabled={npyLoading}
          accent="cyan"
        />
        <FilePickButton
          label="WAV"
          accept=".wav,audio/wav"
          fileName={wavLabel}
          onPick={(file) => onFilesDrop?.(pairClipFiles([], [file]))}
          disabled={npyLoading}
          accent="green"
        />
      </div>

      {expectedOutputKind && (
        <p className="text-[10px] text-gray-500">
          Run 예상: {outputKindLabel(expectedOutputKind)}
        </p>
      )}
    </div>
  )
}
