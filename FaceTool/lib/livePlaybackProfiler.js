/**
 * Live playback stage profiler (client-side).
 * Tracks cache, GPU/CPU mesh update, network fetch, and rAF cost.
 */

function avg(arr) {
  if (!arr.length) return 0
  let s = 0
  for (let i = 0; i < arr.length; i += 1) s += arr[i]
  return s / arr.length
}

function max(arr) {
  if (!arr.length) return 0
  let m = 0
  for (let i = 0; i < arr.length; i += 1) if (arr[i] > m) m = arr[i]
  return m
}

export function createLivePlaybackProfiler() {
  return {
    cacheHit: 0,
    cacheMiss: 0,
    missFrames: [],
    posSetMs: [],
    normalMs: [],
    rafMs: [],
    fetchMs: [],
    fetchServerEvalMs: [],
    fetchBlocks: [],
    lastMissFrame: null,
    lastMissRecordedFrame: -1,
    lastMissAt: 0,
    lastAudioFrame: 0,
    lastDisplayedFrame: -1,
    bufferGap: 0,
    prefetchInFlight: false,
    lastBottleneck: '',
  }
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function recordCacheHit(p) {
  p.cacheHit += 1
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p @param {number} frame */
export function recordCacheMiss(p, frame) {
  if (p.lastMissRecordedFrame === frame) return
  p.lastMissRecordedFrame = frame
  p.cacheMiss += 1
  p.lastMissFrame = frame
  p.lastMissAt = performance.now()
  if (p.missFrames.length >= 32) p.missFrames.shift()
  p.missFrames.push(frame)
  p.lastBottleneck = 'cache_miss'
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function recordPosUpdate(p, posMs, normalMs) {
  if (posMs > 0) {
    if (p.posSetMs.length >= 120) p.posSetMs.shift()
    p.posSetMs.push(posMs)
  }
  if (normalMs > 0) {
    if (p.normalMs.length >= 120) p.normalMs.shift()
    p.normalMs.push(normalMs)
    if (normalMs > 8) p.lastBottleneck = 'normals'
  }
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function recordRaf(p, ms) {
  if (p.rafMs.length >= 120) p.rafMs.shift()
  p.rafMs.push(ms)
  if (ms > 20) p.lastBottleneck = 'raf'
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function recordFetchBlock(p, { totalMs, serverEvalMs, start, count, cachedFrames }) {
  if (p.fetchMs.length >= 32) p.fetchMs.shift()
  p.fetchMs.push(totalMs)
  if (Number.isFinite(serverEvalMs)) {
    if (p.fetchServerEvalMs.length >= 32) p.fetchServerEvalMs.shift()
    p.fetchServerEvalMs.push(serverEvalMs)
  }
  if (p.fetchBlocks.length >= 16) p.fetchBlocks.shift()
  p.fetchBlocks.push({ start, count, totalMs, serverEvalMs, cachedFrames })
  if (totalMs > 200) p.lastBottleneck = 'fetch'
  if (Number.isFinite(serverEvalMs) && serverEvalMs > totalMs * 0.6) {
    p.lastBottleneck = 'server_eval'
  }
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p @param {Map<number, *>} [cache] */
export function updateBufferGap(p, audioFrame, cacheOrStreamed, displayedFrame) {
  p.lastAudioFrame = audioFrame
  p.lastDisplayedFrame = displayedFrame
  if (cacheOrStreamed instanceof Map) {
    p.bufferGap = cacheOrStreamed.has(audioFrame) ? 0 : 1
  } else {
    p.bufferGap = Math.max(0, audioFrame - (cacheOrStreamed || 0) + 1)
  }
  if (p.bufferGap > 0) p.lastBottleneck = 'cache_miss'
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function resetLiveProfiler(p) {
  const show = p.prefetchInFlight
  Object.assign(p, createLivePlaybackProfiler())
  p.prefetchInFlight = show
}

/** @param {ReturnType<typeof createLivePlaybackProfiler>} p */
export function snapshotLiveProfiler(p) {
  const total = p.cacheHit + p.cacheMiss
  const missRate = total > 0 ? (p.cacheMiss / total) * 100 : 0
  const avgNormal = avg(p.normalMs)
  const maxNormal = max(p.normalMs)
  const avgFetch = avg(p.fetchMs)
  const avgServerEval = avg(p.fetchServerEvalMs)
  const avgRaf = avg(p.rafMs)
  const maxRaf = max(p.rafMs)

  let dominant = p.lastBottleneck || 'ok'
  if (missRate > 5) dominant = 'cache_miss'
  else if (avgNormal > 6 || maxNormal > 12) dominant = 'normals'
  else if (avgFetch > 150 || avgServerEval > 100) dominant = 'server_eval'
  else if (p.bufferGap > 15) dominant = 'prefetch_lag'
  else if (maxRaf > 25) dominant = 'raf'

  const labels = {
    ok: '정상',
    cache_miss: '캐시 미스 (프레임 미도착)',
    normals: 'computeVertexNormals (CPU)',
    fetch: '네트워크 fetch (/frames)',
    server_eval: '서버 RigLogic eval',
    prefetch_lag: '스트리밍 버퍼 부족',
    raf: '렌더 루프 (rAF)',
  }

  return {
    dominant,
    dominantLabel: labels[dominant] || dominant,
    cacheHit: p.cacheHit,
    cacheMiss: p.cacheMiss,
    missRate: missRate.toFixed(1),
    lastMissFrame: p.lastMissFrame,
    avgPosMs: avg(p.posSetMs).toFixed(2),
    avgNormalMs: avgNormal.toFixed(2),
    maxNormalMs: maxNormal.toFixed(2),
    avgFetchMs: avgFetch.toFixed(0),
    avgServerEvalMs: avgServerEval.toFixed(0),
    avgRafMs: avgRaf.toFixed(2),
    maxRafMs: maxRaf.toFixed(2),
    bufferGap: p.bufferGap,
    prefetchInFlight: p.prefetchInFlight,
    lastFetchBlocks: p.fetchBlocks.slice(-3),
    missFramesRecent: p.missFrames.slice(-8),
  }
}

/** UI 갱신 필요 여부 (rAF setState 스로틀용) */
export function perfSnapSignature(s) {
  if (!s) return ''
  const blocks = s.lastFetchBlocks
    .map((b) => `${b.start}:${Math.round(b.totalMs)}:${Math.round(b.serverEvalMs || 0)}`)
    .join(',')
  return [
    s.dominant,
    s.cacheHit,
    s.cacheMiss,
    s.missRate,
    s.lastMissFrame,
    s.avgPosMs,
    s.avgNormalMs,
    s.maxNormalMs,
    s.avgFetchMs,
    s.avgServerEvalMs,
    s.avgRafMs,
    s.maxRafMs,
    s.bufferGap,
    s.prefetchInFlight,
    blocks,
  ].join('|')
}

export function perfSnapsEqual(a, b) {
  return perfSnapSignature(a) === perfSnapSignature(b)
}
