/** MetaHuman Face Board — auto layout from CTRL_* naming (region + L/R/C). */

const REGION_BOX = {
  brow: { cx: 0.5, cy: 0.14, rx: 0.26, ry: 0.08 },
  ear: { cx: 0.5, cy: 0.36, rx: 0.46, ry: 0.06 },
  eye: { cx: 0.5, cy: 0.28, rx: 0.24, ry: 0.11 },
  eyelashes: { cx: 0.5, cy: 0.24, rx: 0.22, ry: 0.05 },
  nose: { cx: 0.5, cy: 0.42, rx: 0.12, ry: 0.09 },
  mouth: { cx: 0.5, cy: 0.56, rx: 0.34, ry: 0.20 },
  jaw: { cx: 0.5, cy: 0.76, rx: 0.22, ry: 0.09 },
  tongue: { cx: 0.5, cy: 0.62, rx: 0.10, ry: 0.07 },
  teeth: { cx: 0.5, cy: 0.50, rx: 0.14, ry: 0.06 },
  neck: { cx: 0.5, cy: 0.90, rx: 0.22, ry: 0.07 },
  other: { cx: 0.5, cy: 0.5, rx: 0.32, ry: 0.12 },
}

const SIDE_X = { L: -0.55, C: 0, R: 0.55 }

/** @param {string} name */
export function parseSide(name) {
  if (name.startsWith('CTRL_L_')) return 'L'
  if (name.startsWith('CTRL_R_')) return 'R'
  if (name.startsWith('CTRL_C_')) return 'C'
  return 'C'
}

/** @param {string} name */
export function parseAxis(name) {
  return name.endsWith('.tx') ? 'tx' : 'ty'
}

export const REGION_META = {
  mouth: { label: '입', labelEn: 'Mouth', color: '#f07a9a' },
  eye: { label: '눈', labelEn: 'Eye', color: '#5ad4e8' },
  jaw: { label: '턱', labelEn: 'Jaw', color: '#d68ac4' },
  brow: { label: '눈썹', labelEn: 'Brow', color: '#7eb8ff' },
  nose: { label: '코', labelEn: 'Nose', color: '#c9956a' },
  tongue: { label: '혀', labelEn: 'Tongue', color: '#e8a0b0' },
  neck: { label: '목', labelEn: 'Neck', color: '#b89060' },
  eyelashes: { label: '속눈썹', labelEn: 'Lashes', color: '#4a9fd4' },
  teeth: { label: '치아', labelEn: 'Teeth', color: '#e8e4dc' },
  ear: { label: '귀', labelEn: 'Ear', color: '#6a8fc4' },
  other: { label: '기타', labelEn: 'Other', color: '#888' },
}

export const REGION_OVERVIEW_ORDER = [
  'brow', 'eyelashes', 'eye', 'ear', 'nose', 'teeth', 'mouth', 'tongue', 'jaw', 'neck', 'other',
]

/** Hotspot on face silhouette (normalized 0–1). */
export const REGION_HOTSPOT = {
  brow: { x: 0.5, y: 0.14 },
  eyelashes: { x: 0.5, y: 0.22 },
  eye: { x: 0.5, y: 0.30 },
  ear: { x: 0.5, y: 0.36 },
  nose: { x: 0.5, y: 0.42 },
  teeth: { x: 0.5, y: 0.50 },
  mouth: { x: 0.5, y: 0.56 },
  tongue: { x: 0.5, y: 0.62 },
  jaw: { x: 0.5, y: 0.74 },
  neck: { x: 0.5, y: 0.88 },
  other: { x: 0.5, y: 0.50 },
}

/** @param {{ region: string }[]} controls */
export function countControlsByRegion(controls) {
  const counts = {}
  for (const c of controls) {
    const r = REGION_BOX[c.region] ? c.region : 'other'
    counts[r] = (counts[r] || 0) + 1
  }
  return counts
}

/** @param {string} name */
export function compactControlLabel(name) {
  const side = parseSide(name)
  const axis = parseAxis(name)
  const core = name
    .replace(/^CTRL_[LRC]_/, '')
    .replace(/\.(tx|ty)$/, '')
    .replace(/_/g, ' ')
  return { side, axis, core, full: shortControlLabel(name) }
}

/** @param {string} name */
export function shortControlLabel(name) {
  return name
    .replace(/^CTRL_/, '')
    .replace(/\.(tx|ty)$/, '')
    .replace(/^([LRC])_/, '$1 ')
}

/** @param {{ index: number, name: string, region: string }[]} controls */
export function layoutFaceBoardControls(controls) {
  const buckets = {}
  for (const c of controls) {
    const region = REGION_BOX[c.region] ? c.region : 'other'
    const side = parseSide(c.name)
    const key = `${region}:${side}`
    ;(buckets[key] = buckets[key] || []).push(c)
  }

  /** @type {{ index: number, name: string, x: number, y: number, axis: 'tx'|'ty', region: string, side: string }[]} */
  const out = []

  for (const [key, items] of Object.entries(buckets)) {
    const [region, side] = key.split(':')
    const box = REGION_BOX[region] || REGION_BOX.other
    items.sort((a, b) => a.name.localeCompare(b.name))

    const n = items.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)))
    const rows = Math.ceil(n / cols)
    const spreadX = Math.min(0.95, 0.72 + n * 0.003)
    const spreadY = Math.min(0.92, 0.65 + n * 0.0025)
    const sideOffset = (SIDE_X[side] ?? 0) * box.rx * 0.78

    items.forEach((c, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const gx = cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0
      const gy = rows > 1 ? (row / (rows - 1)) * 2 - 1 : 0
      const x = box.cx + sideOffset + gx * box.rx * spreadX
      const y = box.cy + gy * box.ry * spreadY
      out.push({
        index: c.index,
        name: c.name,
        x: clamp01(x),
        y: clamp01(y),
        axis: parseAxis(c.name),
        region,
        side,
      })
    })
  }

  return out
}

function clamp01(v) {
  return Math.max(0.04, Math.min(0.96, v))
}
