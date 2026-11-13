/**
 * FaceTool — 탭별 뷰는 dynamic import로 초기 번들 분리.
 * 방문한 탭은 display:none 으로 유지해 상태 보존.
 */

'use client'

import dynamic from 'next/dynamic'
import { useCallback, useState, type ReactNode } from 'react'

import { TAB_IDS, type TabId } from '@/types/tabs'

const tabLoading = (): ReactNode => (
  <div className="flex items-center justify-center h-full min-h-[200px] text-gray-400 text-sm">
    로딩 중…
  </div>
)

const dynamicTab = (loader: () => Promise<{ default: React.ComponentType }>) =>
  dynamic(loader, { loading: tabLoading, ssr: false })

const DatasetView = dynamicTab(() => import('@/views/DatasetView'))
const CsvCompareView = dynamicTab(() => import('@/views/CsvCompareView'))
const TrainingViewWrapper = dynamicTab(() => import('@/components/training/LocalGtEvalView'))
const ServiceView = dynamicTab(() => import('@/views/ServiceView'))
const DatasetBuilderView = dynamicTab(() => import('@/views/DatasetBuilderView'))
const RigLogicView = dynamicTab(() => import('@/views/RigLogicView'))
const FaceCreatorView = dynamicTab(() => import('@/views/FaceCreatorView'))

const TABS: { id: TabId; label: string }[] = [
  { id: 'dataset', label: '데이터셋 검증' },
  { id: 'csvcompare', label: 'CSV 비교' },
  { id: 'training', label: '학습 결과 평가' },
  { id: 'service', label: '서비스' },
  { id: 'datasetbuilder', label: 'Dataset Builder' },
  { id: 'riglogic', label: 'RigLogic 재생' },
  { id: 'facecreator', label: '얼굴 편집' },
]

const TAB_PANELS: Record<TabId, React.ComponentType> = {
  dataset: DatasetView,
  csvcompare: CsvCompareView,
  training: TrainingViewWrapper,
  service: ServiceView,
  datasetbuilder: DatasetBuilderView,
  riglogic: RigLogicView,
  facecreator: FaceCreatorView,
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('facecreator')
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set(['facecreator']))

  const selectTab = useCallback((id: TabId) => {
    setActiveTab(id)
    setVisited((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  return (
    <div className="h-screen flex flex-col">
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur border-b border-white/10 shrink-0">
        <div className="px-4 pt-2 pb-0">
          <div className="flex items-center gap-4 min-h-[44px]">
            <h1 className="text-lg font-bold text-white shrink-0">FaceTool</h1>
            <div className="flex flex-1 gap-0.5 overflow-x-auto scrollbar-thin">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectTab(tab.id)}
                    className={`shrink-0 px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap rounded-t-md border-b-2 transition-colors ${
                      isActive
                        ? 'text-white border-blue-500 bg-white/5'
                        : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        {TAB_IDS.map((id) => {
          if (!visited.has(id)) return null
          const Panel = TAB_PANELS[id]
          const isActive = activeTab === id
          return (
            <div
              key={id}
              className={isActive ? 'h-full' : 'hidden'}
              aria-hidden={!isActive}
            >
              <Panel />
            </div>
          )
        })}
      </div>
    </div>
  )
}
