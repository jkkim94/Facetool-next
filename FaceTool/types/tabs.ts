export const TAB_IDS = [
  'dataset',
  'csvcompare',
  'training',
  'service',
  'datasetbuilder',
  'riglogic',
] as const

export type TabId = (typeof TAB_IDS)[number]

export function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value)
}
