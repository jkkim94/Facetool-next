export type RemapContributor = {
  source: string
  weight: number
}

export type RemapTargetEntry = {
  target: string
  contributors: RemapContributor[]
}

export type CalibrationScalar = {
  scale?: number
  offset?: number
  clampMin?: number
  clampMax?: number
}

export type RemapPayload = {
  arkit52: RemapTargetEntry[]
  coupledPairs?: string[][]
  coupledGroups?: string[][]
  calibrationDefaults?: {
    global?: CalibrationScalar
    perCurveOverrides?: Record<string, CalibrationScalar>
    minWeight?: number
    mouthClose?: Record<string, unknown>
    jawPurseCompensation?: Record<string, unknown>
    smoothing?: Record<string, unknown>
  }
}

export type TrainingDataLike = {
  service?: string
  fps?: number
  frames?: number
  duration?: number
  blendshapes: string[]
  data: number[][]
  outputKind?: string | null
}

export type RemapOptions = {
  minWeightOverride?: number | null
  disableJawPurseCompensation?: boolean
  disableMouthCloseModel?: boolean
  jawPurseFactor?: number | null
  jawPurseFunnelGateScale?: number | null
}
