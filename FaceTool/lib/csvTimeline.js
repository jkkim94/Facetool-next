/**
 * CSV time_sec 타임라인 유틸 (가변 FPS / 60fps 등)
 */

/** timeSec[i] <= t 인 마지막 프레임 인덱스 */
export function findFrameAtTime(timeSec, t) {
  if (!timeSec?.length) return 0
  if (t <= timeSec[0]) return 0
  const last = timeSec.length - 1
  if (t >= timeSec[last]) return last

  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (timeSec[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** time_sec 배열에서 duration·FPS 추정 */
export function estimateTimelineMeta(timeSec) {
  if (!timeSec?.length) {
    return { duration: 0, detectedFps: 30, hasTimeSec: false }
  }

  const duration = timeSec[timeSec.length - 1]
  const dts = []
  const sampleEnd = Math.min(timeSec.length, 200)
  for (let i = 1; i < sampleEnd; i++) {
    const dt = timeSec[i] - timeSec[i - 1]
    if (dt > 1e-6 && dt < 1) dts.push(dt)
  }

  let detectedFps = 30
  if (dts.length > 0) {
    dts.sort((a, b) => a - b)
    const medianDt = dts[Math.floor(dts.length / 2)]
    detectedFps = 1 / medianDt
  }

  return {
    duration,
    detectedFps,
    hasTimeSec: true,
  }
}

export function getTimeAtFrame(timeSec, frameIndex, fallbackFps = 30) {
  if (timeSec?.length && frameIndex >= 0 && frameIndex < timeSec.length) {
    return timeSec[frameIndex]
  }
  return frameIndex / fallbackFps
}
