import fs from 'fs'
import path from 'path'

const PAYLOAD_FILENAMES = [
  'arkit_remap_payload.json',
  'AM_ArKitRemap_v02.mapping_payload.json',
]

/** FaceTool / UE / env 순서로 mapping payload JSON 탐색 */
export function resolveArkitRemapPayloadPath(): string | null {
  const candidates: string[] = []

  if (process.env.ARKIT_REMAP_PAYLOAD_PATH) {
    candidates.push(process.env.ARKIT_REMAP_PAYLOAD_PATH)
  }

  const faceToolRoot = path.join(process.cwd(), 'data')
  for (const name of PAYLOAD_FILENAMES) {
    candidates.push(path.join(faceToolRoot, name))
  }

  if (process.env.RESULTS_BASE_PATH) {
    const base = process.env.RESULTS_BASE_PATH
    candidates.push(
      path.join(base, '.cursor', 'arkit-remap', 'mapping-pose-asset', 'data', PAYLOAD_FILENAMES[1]),
      path.join(base, '.cursor', 'arkit-remap', 'scripts', PAYLOAD_FILENAMES[0]),
    )
  }

  candidates.push(
    path.join('E:\\', '.cursor', 'arkit-remap', 'mapping-pose-asset', 'data', PAYLOAD_FILENAMES[1]),
    path.join('E:\\', '.cursor', 'arkit-remap', 'scripts', PAYLOAD_FILENAMES[0]),
  )

  for (const p of candidates) {
    try {
      const resolved = path.resolve(p)
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved
      }
    } catch {
      // skip
    }
  }
  return null
}

export function loadArkitRemapPayloadFromDisk(): { payload: unknown; path: string } | null {
  const payloadPath = resolveArkitRemapPayloadPath()
  if (!payloadPath) return null
  const raw = fs.readFileSync(payloadPath, 'utf8')
  return { payload: JSON.parse(raw), path: payloadPath }
}
