/** 로컬 GT 클립 — 파일 선택 / 서버 페어 매칭 */

export function clipStemFromPath(filePath) {
  const base = String(filePath || '').replace(/\\/g, '/').split('/').pop() || ''
  return base.replace(/\.(npy|wav|csv)$/i, '')
}

export function clipStemFromFile(file) {
  if (!file?.name) return ''
  return clipStemFromPath(file.name)
}

export function fileApiAbsoluteUrl(absPath, type) {
  const p = encodeURIComponent(String(absPath || '').trim())
  return `/api/file?absolutePath=${p}&type=${type}`
}

const GT_SPLITS = ['train', 'val', 'test', '']

async function probeServerFile(absPath, type) {
  const url = fileApiAbsoluteUrl(absPath, type)
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } })
    if (res.ok || res.status === 206) return { path: absPath, url }
  } catch {
    /* try next */
  }
  return null
}

/** Run GT 폴더에서 stem.ext 탐색 (목록 스캔 없음) */
export async function tryResolveServerFile(stem, gtBasePath, ext, type) {
  if (!stem || !gtBasePath) return null
  for (const split of GT_SPLITS) {
    const filePath = split
      ? `${gtBasePath}\\${split}\\${stem}.${ext}`
      : `${gtBasePath}\\${stem}.${ext}`
    const hit = await probeServerFile(filePath, type)
    if (hit) return hit
  }
  return null
}

export function tryResolveServerWav(stem, gtBasePath) {
  return tryResolveServerFile(stem, gtBasePath, 'wav', 'wav')
}

export function tryResolveServerNpy(stem, gtBasePath) {
  return tryResolveServerFile(stem, gtBasePath, 'npy', 'npy')
}

export function classifyClipFiles(fileList) {
  const npyFiles = []
  const wavFiles = []
  for (const file of fileList) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.npy')) npyFiles.push(file)
    else if (lower.endsWith('.wav')) wavFiles.push(file)
  }
  return { npyFiles, wavFiles }
}

/** 드롭/선택 파일 → stem 기준 NPY+WAV 페어 */
export function pairClipFiles(npyFiles, wavFiles) {
  if (npyFiles.length === 0 && wavFiles.length === 0) {
    return { npyFile: null, wavFile: null, stem: '' }
  }

  const primary = npyFiles[0] || wavFiles[0]
  const stem = clipStemFromFile(primary)

  const npyFile =
    npyFiles.find((f) => clipStemFromFile(f) === stem) || npyFiles[0] || null
  const wavFile =
    wavFiles.find((f) => clipStemFromFile(f) === stem) || wavFiles[0] || null

  return {
    npyFile,
    wavFile,
    stem: stem || clipStemFromFile(npyFile) || clipStemFromFile(wavFile),
  }
}

export function buildClipInfoFromFiles({
  name,
  npyFile,
  npyUrl,
  wavFile,
  wavUrl,
  audioObjectUrl,
}) {
  const resolvedName =
    name ||
    clipStemFromFile(npyFile) ||
    clipStemFromFile(wavFile) ||
    ''
  return {
    name: resolvedName,
    npyFile: npyFile || null,
    npyUrl: npyUrl || null,
    wavFile: wavFile || null,
    wavUrl: wavUrl || null,
    audioObjectUrl: audioObjectUrl || null,
    hasNpy: Boolean(npyFile || npyUrl),
    hasWav: Boolean(wavFile || wavUrl),
  }
}

export function revokeAudioObjectUrl(url) {
  if (url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}
