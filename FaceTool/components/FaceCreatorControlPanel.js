'use client'

import { useMemo, useState } from 'react'
import { REGION_META, REGION_OVERVIEW_ORDER, shortControlLabel } from '../lib/faceBoardLayout'

const EXPR_REGION_ORDER = [
  'brow', 'eye', 'eyelashes', 'nose', 'mouth', 'jaw', 'tongue', 'teeth', 'ear', 'neck', 'other',
]

/** Creator-like feature groups (matches identity_sculpt.py) */
export const SCULPT_FEATURES = [
  { id: 'forehead', label: '이마' },
  { id: 'eyes', label: '눈' },
  { id: 'nose', label: '코' },
  { id: 'cheekbone', label: '광대' },
  { id: 'cheek', label: '볼' },
  { id: 'mouth', label: '입' },
  { id: 'chin', label: '턱' },
  { id: 'jaw', label: '턱선' },
  { id: 'ears', label: '귀' },
  { id: 'skull', label: '두상' },
  { id: 'neck', label: '목' },
]

export function defaultSculptFeatures() {
  const o = {}
  for (const f of SCULPT_FEATURES) o[f.id] = 0
  return o
}

/**
 * @param {{
 *   appearance: { tintR: number, tintG: number, tintB: number, brightness: number },
 *   onAppearanceChange: (key: string, value: number) => void,
 *   sculptFeatures: Record<string, number>,
 *   onSculptFeatureChange: (id: string, value: number) => void,
 *   onSculptAll: (value: number) => void,
 *   onSculptReset: () => void,
 *   controls: { index: number, name: string, region: string, min: number, max: number }[],
 *   valuesRef: React.MutableRefObject<number[]|null>,
 *   valueTick: number,
 *   resetTick: number,
 *   onControlChange: (index: number, value: number) => void,
 *   onExprReset: () => void,
 *   onResetAll: () => void,
 * }} props
 */
export default function FaceCreatorControlPanel({
  appearance,
  onAppearanceChange,
  sculptFeatures,
  onSculptFeatureChange,
  onSculptAll,
  onSculptReset,
  controls,
  valuesRef,
  valueTick,
  resetTick,
  onControlChange,
  onExprReset,
  onResetAll,
}) {
  const [section, setSection] = useState('sculpt') // sculpt | appearance | expression
  const [exprFilter, setExprFilter] = useState('')
  const [exprRegion, setExprRegion] = useState('all')

  const groupedExpr = useMemo(() => {
    const q = exprFilter.trim().toLowerCase()
    const by = {}
    for (const c of controls) {
      if (exprRegion !== 'all' && c.region !== exprRegion) continue
      if (q) {
        const hay = `${c.name} ${shortControlLabel(c.name)}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      const r = EXPR_REGION_ORDER.includes(c.region) ? c.region : 'other'
      ;(by[r] = by[r] || []).push(c)
    }
    const order = [
      ...EXPR_REGION_ORDER.filter((r) => by[r]),
      ...Object.keys(by).filter((r) => !EXPR_REGION_ORDER.includes(r)),
    ]
    return order.map((r) => [r, by[r]])
  }, [controls, exprFilter, exprRegion, valueTick])

  const tabs = [
    { id: 'sculpt', label: '얼굴 만들기' },
    { id: 'appearance', label: '색상' },
    { id: 'expression', label: `표정 (${controls.length})` },
  ]

  const avgSculpt = useMemo(() => {
    const vals = SCULPT_FEATURES.map((f) => sculptFeatures[f.id] ?? 0)
    if (!vals.length) return 0
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [sculptFeatures])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-white/10 bg-[#12151c]">
      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">얼굴 제어</h2>
          <button
            type="button"
            onClick={onResetAll}
            className="rounded bg-white/10 px-2 py-1 text-[10px] text-gray-200 hover:bg-white/20"
          >
            전체 초기화
          </button>
        </div>
        <div className="mt-2 flex rounded overflow-hidden border border-white/15 text-[11px]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSection(t.id)}
              className={`flex-1 px-1.5 py-1.5 ${
                section === t.id ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-gray-200">
        {section === 'sculpt' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2.5">
              <p className="text-[12px] font-medium text-fuchsia-100">부위별 아이덴티티</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                0 = 남자 형태 · 1 = 여자 형태.
                MetaHuman Identity 구역(소프트 가중치)으로 섞어서 경계가 찢어지지 않습니다.
              </p>
            </div>

            <div className="space-y-1.5 rounded border border-white/10 bg-white/[0.03] p-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-sky-300">전체 → 남자</span>
                <span className="font-mono text-gray-400">{Math.round(avgSculpt * 100)}%</span>
                <span className="text-pink-300">여자</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={avgSculpt}
                onChange={(e) => onSculptAll(Number(e.target.value))}
                className="w-full accent-fuchsia-500"
              />
              <div className="grid grid-cols-3 gap-1">
                {[0, 0.5, 1].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onSculptAll(v)}
                    className="rounded border border-white/10 py-1 text-[10px] text-gray-300 hover:bg-white/5"
                  >
                    {v === 0 ? '전부 남자' : v === 1 ? '전부 여자' : '중간'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSculptReset}
                className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-white/5"
              >
                부위 초기화
              </button>
            </div>

            {SCULPT_FEATURES.map((f) => {
              const val = sculptFeatures[f.id] ?? 0
              return (
                <label key={f.id} className="block space-y-0.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-200">{f.label}</span>
                    <span className="font-mono text-gray-500">
                      {val < 0.15 ? '남자' : val > 0.85 ? '여자' : `${Math.round(val * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={val}
                    onChange={(e) => onSculptFeatureChange(f.id, Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </label>
              )
            })}
          </div>
        )}

        {section === 'appearance' && (
          <div className="space-y-4">
            <p className="text-[11px] text-gray-500">
              피부 텍스처에 곱하는 틴트입니다. 눈·치아는 제외합니다.
            </p>
            {[
              { key: 'tintR', label: '빨강 (R)', min: 0.4, max: 1.6 },
              { key: 'tintG', label: '초록 (G)', min: 0.4, max: 1.6 },
              { key: 'tintB', label: '파랑 (B)', min: 0.4, max: 1.6 },
              { key: 'brightness', label: '밝기', min: 0.5, max: 1.8 },
            ].map((row) => (
              <label key={row.key} className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-300">{row.label}</span>
                  <span className="font-mono text-gray-400">{appearance[row.key].toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={row.min}
                  max={row.max}
                  step={0.01}
                  value={appearance[row.key]}
                  onChange={(e) => onAppearanceChange(row.key, Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                onAppearanceChange('tintR', 1)
                onAppearanceChange('tintG', 1)
                onAppearanceChange('tintB', 1)
                onAppearanceChange('brightness', 1)
              }}
              className="w-full rounded border border-white/10 py-1.5 text-[11px] text-gray-300 hover:bg-white/5"
            >
              색상 초기화
            </button>
          </div>
        )}

        {section === 'expression' && (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500">
              표정 컨트롤 (웃기, 눈 감기 등). 얼굴 형태와 별개입니다.
            </p>
            <div className="flex gap-2">
              <input
                type="search"
                value={exprFilter}
                onChange={(e) => setExprFilter(e.target.value)}
                placeholder="컨트롤 검색…"
                className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-gray-200"
              />
              <button
                type="button"
                onClick={onExprReset}
                className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] text-gray-300 hover:bg-white/5"
              >
                표정 초기화
              </button>
            </div>
            <select
              value={exprRegion}
              onChange={(e) => setExprRegion(e.target.value)}
              className="w-full rounded border border-white/10 bg-gray-800 px-2 py-1.5 text-[11px] text-gray-200"
            >
              <option value="all">전체 영역</option>
              {REGION_OVERVIEW_ORDER.map((r) => (
                <option key={r} value={r}>
                  {REGION_META[r]?.label || r}
                </option>
              ))}
            </select>
            {groupedExpr.map(([region, items]) => (
              <details key={region} open={region === 'mouth' || region === 'jaw' || region === 'eye'} className="mb-1">
                <summary className="cursor-pointer select-none py-1 text-[11px] font-semibold text-sky-300">
                  {REGION_META[region]?.label || region} ({items.length})
                </summary>
                <div className="space-y-1.5 pb-2 pl-0.5">
                  {items.map((c) => {
                    const val = valuesRef.current?.[c.index] ?? 0
                    return (
                      <div key={`${c.index}-${resetTick}`} className="rounded bg-white/[0.03] px-1.5 py-1">
                        <div className="mb-0.5 flex justify-between gap-2 text-[10px]">
                          <span className="truncate text-gray-300" title={c.name}>
                            {shortControlLabel(c.name)}
                          </span>
                          <span className="shrink-0 font-mono text-gray-500">{val.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={c.min}
                          max={c.max}
                          step={0.01}
                          value={val}
                          onChange={(e) => onControlChange(c.index, Number(e.target.value))}
                          className="w-full accent-violet-500"
                        />
                      </div>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
