/**
 * Parse serve.py GET /deform_static binary (magic RLDS v1).
 * @param {ArrayBuffer} buf
 */
export function parseDeformStatic(buf) {
  const view = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
  if (magic !== 'RLDS') throw new Error('invalid deform_static magic')

  let o = 4
  const readU32 = () => {
    const v = view.getUint32(o, true)
    o += 4
    return v
  }

  const version = readU32()
  if (version !== 1) throw new Error(`unsupported deform_static v${version}`)

  const V = readU32()
  const J = readU32()
  const apj = readU32()
  const K = readU32()
  const bsCount = readU32()
  const morphCount = readU32()
  readU32() // reserved

  const readF32 = (n) => {
    const arr = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      arr[i] = view.getFloat32(o, true)
      o += 4
    }
    return arr
  }

  const readI32 = (n) => {
    const arr = new Int32Array(n)
    for (let i = 0; i < n; i += 1) {
      arr[i] = view.getInt32(o, true)
      o += 4
    }
    return arr
  }

  const readI64AsI32 = (n) => {
    const arr = new Int32Array(n)
    for (let i = 0; i < n; i += 1) {
      arr[i] = Number(view.getBigInt64(o, true))
      o += 8
    }
    return arr
  }

  const center = readF32(3)
  const parents = readI32(J)
  const neutralT = readF32(J * 3)
  const neutralQ = readF32(J * 4)
  const neutralS = readF32(J * 3)
  const bindInv = readF32(J * 16)
  const neutralPos = readF32(V * 3)
  const skinW = readF32(V * K)
  const skinJi = readI32(V * K)

  const morphSectionBase = o
  const morphVidxBytes = morphCount * 4
  const morphDeltaBytes = morphCount * 3 * 4
  const morphChanBytes = morphCount * 4
  const morphVidxInt64Bytes = morphCount * 8
  const useInt64Vidx =
    morphSectionBase + morphVidxInt64Bytes + morphDeltaBytes + morphChanBytes === buf.byteLength &&
    morphSectionBase + morphVidxBytes + morphDeltaBytes + morphChanBytes !== buf.byteLength

  const morphVidx = useInt64Vidx ? readI64AsI32(morphCount) : readI32(morphCount)
  const morphDelta = readF32(morphCount * 3)
  const morphChan = readI32(morphCount)

  return {
    V,
    J,
    apj,
    K,
    bsCount,
    morphCount,
    center,
    parents,
    neutralT,
    neutralQ,
    neutralS,
    bindInv,
    neutralPos,
    skinW,
    skinJi,
    morphVidx,
    morphDelta,
    morphChan,
  }
}

/**
 * Parse POST /eval_rig/batch binary (magic RLRG v1).
 * @returns {{ bsCount: number, joCount: number, frames: { bs: Float32Array, jo: Float32Array }[] }}
 */
export function parseEvalRigBatch(buf) {
  const view = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
  if (magic !== 'RLRG') throw new Error('invalid eval_rig batch magic')

  let o = 4
  const version = view.getUint32(o, true); o += 4
  if (version !== 1) throw new Error(`unsupported eval_rig v${version}`)

  const frameCount = view.getUint32(o, true); o += 4
  const bsCount = view.getUint32(o, true); o += 4
  const joCount = view.getUint32(o, true); o += 4

  const all = new Float32Array(buf, o)
  const bsFlat = all.subarray(0, frameCount * bsCount)
  const joFlat = all.subarray(frameCount * bsCount, frameCount * (bsCount + joCount))
  const frames = []
  for (let f = 0; f < frameCount; f += 1) {
    frames.push({
      bs: bsFlat.subarray(f * bsCount, (f + 1) * bsCount),
      jo: joFlat.subarray(f * joCount, (f + 1) * joCount),
    })
  }
  return { bsCount, joCount, frameCount, frames }
}

/** Single-frame shortcut for live GUI eval. */
export function parseEvalRigFrame(buf) {
  const { frames } = parseEvalRigBatch(buf)
  if (!frames.length) throw new Error('empty eval_rig response')
  return frames[0]
}
