import type { InferenceSuccessBody, RunEntry } from '@/types/api'

export type OutputKind = 'arkit_51' | 'metahuman_260'

/** run 목록 항목 정규화 (문자열 또는 객체) */
export function normalizeRunEntry(raw: unknown): RunEntry | null {
  if (typeof raw === 'string') {
    const id = raw.trim()
    return id ? { id, label: id } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id ?? o.name ?? o.run ?? '').trim()
  if (!id) return null
  const label =
    typeof o.label === 'string' && o.label.trim() ? o.label.trim() : id
  const outputKind = o.output_kind
  return {
    id,
    label,
    output_kind:
      outputKind === 'arkit_51' || outputKind === 'metahuman_260'
        ? outputKind
        : undefined,
    strategy: typeof o.strategy === 'string' ? o.strategy : undefined,
    path: typeof o.path === 'string' ? o.path : undefined,
    epochCount:
      typeof o.epochCount === 'number' ? o.epochCount : undefined,
    hasBlendshapeSamples:
      typeof o.hasBlendshapeSamples === 'boolean'
        ? o.hasBlendshapeSamples
        : undefined,
  }
}

/** 200ch run 제외 등 서비스 탭 노출 필터 */
export function filterServiceRuns(runs: RunEntry[]): RunEntry[] {
  return runs.filter((r) => !/control200/i.test(r.id))
}

export function isMetaHumanRun(run: RunEntry | string | null | undefined): boolean {
  if (!run) return false
  const id = typeof run === 'string' ? run : run.id
  const kind = typeof run === 'string' ? undefined : run.output_kind
  return (
    kind === 'metahuman_260' ||
    /results_D8_control260_/i.test(id) ||
    /control260|lipsync200|metahuman/i.test(id)
  )
}

export function isArkitRun(run: RunEntry | string | null | undefined): boolean {
  if (!run) return false
  const id = typeof run === 'string' ? run : run.id
  const kind = typeof run === 'string' ? undefined : run.output_kind
  return kind === 'arkit_51' || id === 'pretrained'
}

/** run 목록을 ARKit / MetaHuman / 기타로 그룹 */
export function groupRunsForUi(runs: RunEntry[]): {
  arkit: RunEntry[]
  metahuman: RunEntry[]
  other: RunEntry[]
} {
  const arkit: RunEntry[] = []
  const metahuman: RunEntry[] = []
  const other: RunEntry[] = []
  for (const r of runs) {
    if (isMetaHumanRun(r)) metahuman.push(r)
    else if (isArkitRun(r)) arkit.push(r)
    else other.push(r)
  }
  return { arkit, metahuman, other }
}

/** 추론 응답에서 출력 종류 판별 */
export function detectOutputKind(
  res: Pick<
    InferenceSuccessBody,
    'output_kind' | 'channels' | 'blendshapes'
  >,
  runId?: string
): OutputKind {
  if (res.output_kind === 'arkit_51' || res.output_kind === 'metahuman_260') {
    return res.output_kind
  }
  const channelCount =
    res.channels ?? res.blendshapes?.length ?? 0
  if (runId === 'pretrained' || channelCount === 51) return 'arkit_51'
  if (channelCount === 260 || channelCount === 280 || channelCount === 200) {
    return 'metahuman_260'
  }
  throw new Error(`Unsupported channels: ${channelCount}`)
}

/** ARKit GLB morph 매핑용 이름 (MetaHuman 경로에서는 빈 배열) */
export function getGlbMorphNames(
  res: Pick<
    InferenceSuccessBody,
    'output_kind' | 'channels' | 'blendshapes' | 'blendshapes_glb'
  >
): string[] {
  const kind =
    res.output_kind ??
    (res.channels === 260 || res.channels === 280
      ? 'metahuman_260'
      : res.channels === 51
        ? 'arkit_51'
        : undefined)
  if (kind === 'metahuman_260' || res.channels === 260 || res.channels === 280) return []
  if (res.blendshapes_glb?.length) return res.blendshapes_glb
  return res.blendshapes ?? []
}

export function outputKindLabel(kind: OutputKind): string {
  return kind === 'arkit_51' ? 'ARKit 51 (GLB)' : 'MetaHuman 260 (RigLogic)'
}

/** run 선택만으로 예상 출력 (추론/GT 로드 전 UI 분기용) */
export function expectedOutputKindForRun(
  run: RunEntry | string | null | undefined,
): OutputKind | null {
  if (isMetaHumanRun(run)) return 'metahuman_260'
  if (isArkitRun(run)) return 'arkit_51'
  return null
}
