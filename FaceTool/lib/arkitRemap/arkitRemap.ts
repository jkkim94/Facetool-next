import { ARKIT_52_NAMES, GLB_ARKIT_NAMES, arkitToGlbName } from './constants'
import type {
  CalibrationScalar,
  RemapOptions,
  RemapPayload,
  TrainingDataLike,
} from './types'

const EPS = 1e-8

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val))
}

function applyCalibration(values: number[], cal: CalibrationScalar): number[] {
  const scale = cal.scale ?? 1.0
  const offset = cal.offset ?? 0.0
  const lo = cal.clampMin ?? 0.0
  const hi = cal.clampMax ?? 1.0
  return values.map((v) => clamp(v * scale + offset, lo, hi))
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length
  if (n === 0 || matrix.some((row) => row.length !== n)) return null

  const aug: number[][] = matrix.map((row, i) => [
    ...row.map((v) => Number(v)),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r
    }
    const pivot = aug[pivotRow][col]
    if (Math.abs(pivot) < 1e-12) return null
    if (pivotRow !== col) {
      ;[aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]]
    }
    const invPivot = 1.0 / aug[col][col]
    for (let j = 0; j < 2 * n; j += 1) aug[col][j] *= invPivot

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = aug[row][col]
      if (Math.abs(factor) < 1e-12) continue
      for (let j = 0; j < 2 * n; j += 1) aug[row][j] -= factor * aug[col][j]
    }
  }

  return aug.map((row) => row.slice(n))
}

type TargetIndexEntry = {
  contributors: { source: string; weight: number }[]
  sumWeightSquared: number
}

type SourceCache = Map<string, number[]>

function buildTargetIndex(
  payload: RemapPayload,
  minWeightOverride?: number | null,
): { targets: Map<string, TargetIndexEntry>; requiredSources: Set<string> } {
  const cal = payload.calibrationDefaults ?? {}
  let minWeight = cal.minWeight ?? 0.0
  if (minWeightOverride != null) minWeight = Number(minWeightOverride)

  const targets = new Map<string, TargetIndexEntry>()
  const requiredSources = new Set<string>()

  for (const entry of payload.arkit52) {
    let contributors = entry.contributors
    if (minWeight > 0) {
      contributors = contributors.filter((c) => Math.abs(c.weight) >= minWeight)
    }
    const sw2 = contributors.reduce((s, c) => s + c.weight ** 2, 0)
    targets.set(entry.target, { contributors, sumWeightSquared: sw2 })
    for (const c of contributors) requiredSources.add(c.source.toLowerCase())
  }

  const mc = cal.mouthClose ?? {}
  for (const key of ['lipsTowardsSourceCurves', 'lipsPurseSourceCurves'] as const) {
    const curves = mc[key]
    if (Array.isArray(curves)) {
      for (const curve of curves) requiredSources.add(String(curve).toLowerCase())
    }
  }
  const legacy = mc.lipsTogetherSourceCurve
  if (legacy) requiredSources.add(String(legacy).toLowerCase())

  return { targets, requiredSources }
}

function buildSourceCacheFromTraining(training: TrainingDataLike): SourceCache {
  const cache: SourceCache = new Map()
  const { blendshapes, data } = training
  for (let i = 0; i < blendshapes.length; i += 1) {
    cache.set(blendshapes[i].toLowerCase(), data.map((row) => Number(row[i]) || 0))
  }
  return cache
}

function solveGroupTargets(
  targetNames: string[],
  targetIndex: Map<string, TargetIndexEntry>,
  sourceCache: SourceCache,
  frameCount: number,
): number[][] | null {
  if (targetNames.length < 2) return null

  const targetData = targetNames.map((n) => targetIndex.get(n)).filter(Boolean) as TargetIndexEntry[]
  if (targetData.length !== targetNames.length) return null

  const weightMap = new Map<string, number[]>()
  targetData.forEach((tdata, idx) => {
    for (const c of tdata.contributors) {
      const key = c.source.toLowerCase()
      if (!weightMap.has(key)) weightMap.set(key, new Array(targetNames.length).fill(0))
      weightMap.get(key)![idx] = c.weight
    }
  })

  const active = [...weightMap.entries()].filter(([src]) => sourceCache.has(src))
  if (!active.length) return null

  const n = targetNames.length
  const gram: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      gram[i][j] = active.reduce((s, [, w]) => s + w[i] * w[j], 0)
    }
  }

  const gramInv = invertMatrix(gram)
  if (!gramInv) return null

  const curveData = active.map(([src, weights]) => ({
    vals: sourceCache.get(src)!,
    weights,
  }))
  const outputs: number[][] = targetNames.map(() => new Array(frameCount).fill(0))

  for (let frameIdx = 0; frameIdx < frameCount; frameIdx += 1) {
    const rhs = new Array(n).fill(0)
    for (const { vals, weights } of curveData) {
      const obs = vals[frameIdx]
      weights.forEach((w, i) => {
        rhs[i] += obs * w
      })
    }
    const solved = gramInv.map((row) => row.reduce((s, v, j) => s + v * rhs[j], 0))
    solved.forEach((value, i) => {
      outputs[i][frameIdx] = Math.max(0, value)
    })
  }

  return outputs
}

function meanSourceGroup(
  sourceCache: SourceCache,
  curveNames: string[],
  frameCount: number,
): { values: number[] | null; count: number } {
  const found = curveNames.map((c) => c.toLowerCase()).filter((c) => sourceCache.has(c))
  if (!found.length) return { values: null, count: 0 }
  const values = new Array(frameCount).fill(0)
  for (const key of found) {
    const src = sourceCache.get(key)!
    for (let i = 0; i < frameCount; i += 1) values[i] += src[i]
  }
  return { values: values.map((v) => v / found.length), count: found.length }
}

function weightedSynthesis(
  targetIndex: Map<string, TargetIndexEntry>,
  sourceCache: SourceCache,
  calibration: NonNullable<RemapPayload['calibrationDefaults']>,
  frameCount: number,
  coupledPairs: string[][] = [],
  coupledGroups: string[][] = [],
): Map<string, number[]> {
  const globalCal = calibration.global ?? {}
  const overrides = calibration.perCurveOverrides ?? {}
  const arkitOutput = new Map<string, number[]>()
  const coupledTargets = new Set<string>()

  const solveGroups = [
    ...coupledGroups.filter((g) => g.length >= 2).map((g) => [...g]),
    ...coupledPairs.filter((p) => p.length === 2).map((p) => [...p]),
  ]

  for (const groupNames of solveGroups) {
    if (new Set(groupNames).size !== groupNames.length) continue
    if (groupNames.some((n) => !targetIndex.has(n))) continue
    if (groupNames.some((n) => coupledTargets.has(n))) continue

    const groupValues = solveGroupTargets(groupNames, targetIndex, sourceCache, frameCount)
    if (!groupValues) continue

    groupNames.forEach((name, idx) => {
      const vals = applyCalibration(groupValues[idx], overrides[name] ?? globalCal)
      arkitOutput.set(name, vals)
      coupledTargets.add(name)
    })
  }

  for (const [arkitName, tdata] of targetIndex.entries()) {
    if (coupledTargets.has(arkitName)) continue
    const { contributors, sumWeightSquared: sw2 } = tdata
    if (sw2 === 0) continue

    const values = new Array(frameCount).fill(0)
    let found = 0
    for (const c of contributors) {
      const srcLower = c.source.toLowerCase()
      if (!sourceCache.has(srcLower)) continue
      found += 1
      const srcVals = sourceCache.get(srcLower)!
      for (let i = 0; i < frameCount; i += 1) values[i] += srcVals[i] * c.weight
    }
    if (found === 0) continue

    const normalized = values.map((v) => v / sw2)
    arkitOutput.set(arkitName, applyCalibration(normalized, overrides[arkitName] ?? globalCal))
  }

  return arkitOutput
}

function computeMouthPair(
  arkitOutput: Map<string, number[]>,
  sourceCache: SourceCache,
  calibration: NonNullable<RemapPayload['calibrationDefaults']>,
  frameCount: number,
  options: RemapOptions,
): void {
  const mcConfig = { ...(calibration.mouthClose ?? {}) }
  const jpConfig = { ...(calibration.jawPurseCompensation ?? {}) }

  if (options.disableMouthCloseModel) mcConfig.enabled = false
  if (options.disableJawPurseCompensation) jpConfig.enabled = false
  if (options.jawPurseFactor != null) jpConfig.factor = options.jawPurseFactor
  if (options.jawPurseFunnelGateScale != null) {
    jpConfig.funnelGateScale = options.jawPurseFunnelGateScale
  }

  const mcEnabled = mcConfig.enabled !== false
  const jpEnabled = jpConfig.enabled === true

  if (!mcEnabled && !jpEnabled) return
  if (!arkitOutput.has('JawOpen')) return

  const rawJaw = [...(arkitOutput.get('JawOpen') ?? [])]

  const lpCurves = (jpConfig.lipsPurseSourceCurves ??
    mcConfig.lipsPurseSourceCurves ??
    []) as string[]
  const { values: lpVals } = meanSourceGroup(sourceCache, lpCurves, frameCount)

  const funnelCurves = (jpConfig.funnelSourceCurves ??
    mcConfig.funnelSourceCurves ??
    []) as string[]
  const { values: fnVals } = funnelCurves.length
    ? meanSourceGroup(sourceCache, funnelCurves, frameCount)
    : { values: null }

  let adjustedJaw = rawJaw
  const jawFactor = Number(jpConfig.factor ?? 0.75)
  if (jpEnabled && lpVals) {
    const funnelGateScale = Number(jpConfig.funnelGateScale ?? 0)
    const useFunnelGate = fnVals != null && funnelGateScale > 0
    adjustedJaw = new Array(frameCount).fill(0)
    for (let i = 0; i < frameCount; i += 1) {
      const effFactor = useFunnelGate
        ? jawFactor * Math.max(0, 1 - funnelGateScale * fnVals[i])
        : jawFactor
      adjustedJaw[i] = Math.max(0, rawJaw[i] - effFactor * lpVals[i])
    }
    arkitOutput.set('JawOpen', adjustedJaw)
  }

  if (!mcEnabled) return

  const ltCurves = (mcConfig.lipsTowardsSourceCurves ?? []) as string[]
  const lpWeight = Number(mcConfig.lipsPurseWeight ?? 0)
  const { values: ltVals } = meanSourceGroup(sourceCache, ltCurves, frameCount)

  const hasLt = ltVals != null
  const hasLp = lpVals != null && lpWeight > 0
  const mcFunnelGateScale = Number(mcConfig.funnelGateScale ?? 0)
  const mcUseFunnel = mcFunnelGateScale > 0 && fnVals != null

  let lipClosure: number[] | null = null
  let mcVals: number[]

  if (hasLt || hasLp) {
    lipClosure = new Array(frameCount).fill(0)
    if (hasLt) {
      for (let i = 0; i < frameCount; i += 1) lipClosure[i] += ltVals![i]
    }
    if (hasLp) {
      for (let i = 0; i < frameCount; i += 1) lipClosure[i] += lpWeight * lpVals![i]
    }
    if (mcUseFunnel) {
      for (let i = 0; i < frameCount; i += 1) {
        lipClosure[i] *= Math.max(0, 1 - mcFunnelGateScale * fnVals![i])
      }
    }

    let rawJawPow = Number(mcConfig.rawJawMultiplierPower ?? 1)
    if (!Number.isFinite(rawJawPow) || rawJawPow < 0) rawJawPow = 0

    mcVals = lipClosure.map((lc, i) => lc * Math.max(0, rawJaw[i]) ** rawJawPow)
  } else {
    const lipsKey = String(
      mcConfig.lipsTogetherSourceCurve ?? 'CTRL_Expressions_Mouth_Lips_Together_UL',
    ).toLowerCase()
    if (!sourceCache.has(lipsKey)) return
    const lipsVals = sourceCache.get(lipsKey)!
    mcVals = lipsVals.map((v, i) => v * rawJaw[i])
  }

  const fcRatio = Number(mcConfig.forwardConstraintRatio ?? 1)
  let sealCapRatio = Number(mcConfig.sealCapRatio ?? 0)
  if (!Number.isFinite(sealCapRatio) || sealCapRatio < 0) sealCapRatio = 0

  for (let i = 0; i < frameCount; i += 1) {
    let cap = adjustedJaw[i] * fcRatio
    if (sealCapRatio > 0 && lipClosure) {
      const lipSealCap = lipClosure[i] * sealCapRatio
      if (lipSealCap > cap) cap = lipSealCap
    }
    if (mcVals[i] > cap) mcVals[i] = cap
  }

  const puckerFactor = Number(jpConfig.puckerFactor ?? 0)
  if (puckerFactor > 0 && arkitOutput.has('MouthPucker')) {
    const puckerVals = arkitOutput.get('MouthPucker')!
    for (let i = 0; i < frameCount; i += 1) {
      const effCap = Math.max(0, adjustedJaw[i] - puckerFactor * puckerVals[i])
      if (mcVals[i] > effCap) mcVals[i] = effCap
    }
  }

  mcVals = applyCalibration(mcVals, {
    scale: Number(mcConfig.scale ?? 1),
    offset: Number(mcConfig.offset ?? 0),
    clampMin: Number(mcConfig.clampMin ?? 0),
    clampMax: Number(mcConfig.clampMax ?? 0.5),
  })
  arkitOutput.set('MouthClose', mcVals)
}

function ensureExpectedArkitCurves(
  arkitOutput: Map<string, number[]>,
  frameCount: number,
): void {
  for (const name of ARKIT_52_NAMES) {
    if (!arkitOutput.has(name)) {
      arkitOutput.set(name, new Array(frameCount).fill(0))
    }
  }
}

function applyRuntimeCalibrationOverrides(
  calibration: NonNullable<RemapPayload['calibrationDefaults']>,
  options: RemapOptions,
): NonNullable<RemapPayload['calibrationDefaults']> {
  const out = JSON.parse(JSON.stringify(calibration)) as typeof calibration
  if (options.disableJawPurseCompensation) {
    out.jawPurseCompensation = { ...out.jawPurseCompensation, enabled: false }
  }
  if (options.disableMouthCloseModel) {
    out.mouthClose = { ...out.mouthClose, enabled: false }
  }
  if (options.jawPurseFactor != null) {
    out.jawPurseCompensation = { ...out.jawPurseCompensation, factor: options.jawPurseFactor }
  }
  if (options.jawPurseFunnelGateScale != null) {
    out.jawPurseCompensation = {
      ...out.jawPurseCompensation,
      funnelGateScale: options.jawPurseFunnelGateScale,
    }
  }
  if (options.minWeightOverride != null) {
    out.minWeight = options.minWeightOverride
  }
  return out
}

/** MetaHuman training data → ARKit GLB training data (camelCase 51 morphs) */
export function remapMetaHumanToArkitGlb(
  training: TrainingDataLike,
  payload: RemapPayload,
  options: RemapOptions = {},
): TrainingDataLike {
  if (!training?.blendshapes?.length || !training?.data?.length) {
    throw new Error('Remap 입력: blendshapes/data 필요')
  }

  const frameCount = training.data.length
  const calibration = applyRuntimeCalibrationOverrides(
    payload.calibrationDefaults ?? {},
    options,
  )

  const minWeight =
    options.minWeightOverride ?? calibration.minWeight ?? undefined

  const { targets } = buildTargetIndex(payload, minWeight)
  const sourceCache = buildSourceCacheFromTraining(training)

  const arkitOutput = weightedSynthesis(
    targets,
    sourceCache,
    calibration,
    frameCount,
    payload.coupledPairs ?? [],
    payload.coupledGroups ?? [],
  )

  computeMouthPair(arkitOutput, sourceCache, calibration, frameCount, options)
  ensureExpectedArkitCurves(arkitOutput, frameCount)

  const glbNames = [...GLB_ARKIT_NAMES]
  const data: number[][] = []
  for (let f = 0; f < frameCount; f += 1) {
    const row: number[] = []
    for (const glbName of glbNames) {
      const pascal = glbName.charAt(0).toUpperCase() + glbName.slice(1)
      row.push(clamp(arkitOutput.get(pascal)?.[f] ?? 0, 0, 1))
    }
    data.push(row)
  }

  const fps = training.fps ?? 30
  return {
    service: training.service ? `${training.service}_arkit_remap` : 'arkit_remap',
    fps,
    frames: frameCount,
    duration: frameCount / fps,
    blendshapes: glbNames,
    data,
    outputKind: 'arkit_51',
  }
}

export function validateRemapPayload(payload: unknown): payload is RemapPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as RemapPayload
  return Array.isArray(p.arkit52) && p.arkit52.length > 0
}
