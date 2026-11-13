import * as THREE from 'three'
import { parseDeformStatic, parseEvalRigBatch } from '@/lib/loadDeformStatic'
import {
  extractEvalFaceMesh,
  filterEvalFaceGroups,
  makeEvalFaceGeometry,
} from '@/lib/eval/rigHeadGeometry'

const RIG_BATCH = 120
const FIRST_BATCH = 1

export function rowsFromControlData(data, blendshapes) {
  return data.map((row) =>
    Array.isArray(row) ? row : blendshapes.map((name) => row[name] ?? 0),
  )
}

async function fetchEvalRigBatch(columns, rows) {
  const resp = await fetch('/api/riglogic/eval_rig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns, rows }),
    cache: 'no-store',
  })
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}))
    throw new Error(j.error || `eval_rig HTTP ${resp.status}`)
  }
  return parseEvalRigBatch(await resp.arrayBuffer())
}

async function loadAllFrames(blendshapes, data, onProgress, signal) {
  const rows = rowsFromControlData(data, blendshapes)
  const allFrames = []

  const runBatch = async (start, size) => {
    const slice = rows.slice(start, start + size)
    if (!slice.length) return
    const parsed = await fetchEvalRigBatch(blendshapes, slice)
    if (parsed.frameCount !== slice.length) {
      throw new Error(`rig batch @${start}: expected ${slice.length}, got ${parsed.frameCount}`)
    }
    allFrames.push(...parsed.frames)
    onProgress?.(allFrames.length, rows.length)
  }

  await runBatch(0, Math.min(FIRST_BATCH, rows.length))
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

  for (let start = FIRST_BATCH; start < rows.length; start += RIG_BATCH) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    await runBatch(start, RIG_BATCH)
  }
  return allFrames
}

function loadTexture(loader, serverBase, name, colorSpace) {
  return new Promise((resolve) => {
    loader.load(
      `${serverBase}/texture?name=${name}`,
      (t) => {
        t.flipY = true
        t.colorSpace = colorSpace
        t.anisotropy = 8
        resolve(t)
      },
      undefined,
      () => resolve(null),
    )
  })
}

function makeMaterial(tex, name, loader, serverBase) {
  const n = (name || '').toLowerCase()
  let roughness = 0.62
  if (n.startsWith('eyeleft') || n.startsWith('eyeright')) roughness = 0.18
  else if (n.startsWith('teeth')) roughness = 0.38
  const mm = new THREE.MeshStandardMaterial({
    color: tex?.map ? 0xffffff : 0xc8a08c,
    roughness,
    metalness: 0,
    side: THREE.FrontSide,
  })
  if (tex?.map) {
    loadTexture(loader, serverBase, tex.map, THREE.SRGBColorSpace).then((t) => {
      if (t) {
        mm.map = t
        mm.needsUpdate = true
      }
    })
  }
  if (tex?.normalMap) {
    loadTexture(loader, serverBase, tex.normalMap, THREE.NoColorSpace).then((t) => {
      if (t) {
        mm.normalMap = t
        mm.needsUpdate = true
      }
    })
  }
  return mm
}

/**
 * GT + Pred control → shared geo/deform + rig frames (한 번만 로드)
 */
export async function loadRigCompareBundle({
  serverBase,
  gtData,
  predData,
  onProgress,
  signal,
}) {
  const u = (p) => `${serverBase}${p}`

  const healthRes = await fetch('/api/riglogic/eval_rig', { signal })
  if (!healthRes.ok) throw new Error('eval_rig API unavailable')
  const health = await healthRes.json()
  if (!health?.available) {
    throw new Error('serve.py 재실행 필요 (GET /deform_static + POST /eval_rig)')
  }

  onProgress?.('geometry...')
  const geo = await fetch(u('/geo')).then((r) => r.json())
  if (geo.error) throw new Error(geo.error)

  const [idxBuf, uvBuf, staticBuf] = await Promise.all([
    fetch(u(geo.indicesUrl), { signal }).then((r) => r.arrayBuffer()),
    fetch(u(geo.uvsUrl), { signal }).then((r) => r.arrayBuffer()),
    fetch('/api/riglogic/deform_static', { signal }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `deform_static HTTP ${r.status}`)
      }
      return r.arrayBuffer()
    }),
  ])

  const assets = parseDeformStatic(staticBuf)
  if (assets.V !== geo.numVertices) {
    throw new Error(`vertex mismatch geo=${geo.numVertices} static=${assets.V}`)
  }

  const indices = new Uint32Array(idxBuf)
  const uvs = new Float32Array(uvBuf)
  const evalMesh = extractEvalFaceMesh(
    indices,
    uvs,
    geo.meshes,
    geo.meshVertexStarts,
    geo.groups,
  )
  const evalGroups =
    evalMesh.groups?.length > 0
      ? evalMesh.groups
      : filterEvalFaceGroups(geo.groups)

  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')

  let material
  const baseGeometry = makeEvalFaceGeometry(
    evalMesh.indices,
    evalMesh.uvs,
    evalMesh.evalVertexCount,
    evalMesh.groups,
  )

  if (evalGroups?.length > 1) {
    material = evalGroups.map((g) =>
      makeMaterial(g.textures || {}, g.name, loader, serverBase),
    )
  } else {
    const g0 = evalGroups?.[0] || geo.groups?.[0]
    material = makeMaterial(
      g0?.textures || {},
      g0?.name || 'head',
      loader,
      serverBase,
    )
  }

  const cy = (geo.bboxMax[1] + geo.bboxMin[1]) / 2
  const size = Math.max(
    geo.bboxMax[0] - geo.bboxMin[0],
    geo.bboxMax[1] - geo.bboxMin[1],
    geo.bboxMax[2] - geo.bboxMin[2],
  )

  onProgress?.('GT rig eval...')
  const gtFrames = await loadAllFrames(gtData.blendshapes, gtData.data, (done, total) => {
    onProgress?.(`GT rig ${done}/${total}`)
  }, signal)

  onProgress?.('Pred rig eval...')
  const predFrames = await loadAllFrames(
    predData.blendshapes,
    predData.data,
    (done, total) => {
      onProgress?.(`Pred rig ${done}/${total}`)
    },
    signal,
  )

  return {
    assets,
    geo,
    evalVertexCount: evalMesh.evalVertexCount,
    headVertexCount: evalMesh.evalVertexCount,
    baseGeometry,
    material,
    gtFrames,
    predFrames,
    camera: { cy, size, position: [0, cy, size * 2.2] },
    target: [0, cy, 0],
  }
}
