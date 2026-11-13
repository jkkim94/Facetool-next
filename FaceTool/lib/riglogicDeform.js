/**
 * Browser-side morph + linear blend skinning (port of bake.py / face_model._deform).
 * Matrices use NumPy row-major layout: index = row * 4 + col.
 */

function quatToMatrix(qx, qy, qz, qw, out, off) {
  const n = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1
  qx /= n; qy /= n; qz /= n; qw /= n
  const xx = qx * qx; const yy = qy * qy; const zz = qz * qz
  const xy = qx * qy; const xz = qx * qz; const yz = qy * qz
  const wx = qw * qx; const wy = qw * qy; const wz = qw * qz
  out[off] = 1 - 2 * (yy + zz)
  out[off + 1] = 2 * (xy - wz)
  out[off + 2] = 2 * (xz + wy)
  out[off + 3] = 2 * (xy + wz)
  out[off + 4] = 1 - 2 * (xx + zz)
  out[off + 5] = 2 * (yz - wx)
  out[off + 6] = 2 * (xz - wy)
  out[off + 7] = 2 * (yz + wx)
  out[off + 8] = 1 - 2 * (xx + yy)
}

function quatMul(ax, ay, az, aw, bx, by, bz, bw) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function splitJointBuffer(jo, apj, J) {
  const t = new Float32Array(J * 3)
  const q = new Float32Array(J * 4)
  const s = new Float32Array(J * 3)
  for (let j = 0; j < J; j += 1) {
    const b = j * apj
    t[j * 3] = jo[b]; t[j * 3 + 1] = jo[b + 1]; t[j * 3 + 2] = jo[b + 2]
    q[j * 4] = jo[b + 3]; q[j * 4 + 1] = jo[b + 4]; q[j * 4 + 2] = jo[b + 5]; q[j * 4 + 3] = jo[b + 6]
    s[j * 3] = jo[b + 7]; s[j * 3 + 1] = jo[b + 8]; s[j * 3 + 2] = jo[b + 9]
  }
  return { t, q, s }
}

function composeLocal(trans, quat, scale, J, local) {
  const R = new Float32Array(9)
  for (let j = 0; j < J; j += 1) {
    const o = j * 16
    quatToMatrix(quat[j * 4], quat[j * 4 + 1], quat[j * 4 + 2], quat[j * 4 + 3], R, 0)
    const sx = scale[j * 3]; const sy = scale[j * 3 + 1]; const sz = scale[j * 3 + 2]
    for (let r = 0; r < 3; r += 1) {
      local[o + r * 4] = R[r * 3] * sx
      local[o + r * 4 + 1] = R[r * 3 + 1] * sy
      local[o + r * 4 + 2] = R[r * 3 + 2] * sz
      local[o + r * 4 + 3] = 0
    }
    // NumPy bake.py: translation in column 3 (not bottom row)
    local[o + 3] = trans[j * 3]
    local[o + 7] = trans[j * 3 + 1]
    local[o + 11] = trans[j * 3 + 2]
    local[o + 12] = 0
    local[o + 13] = 0
    local[o + 14] = 0
    local[o + 15] = 1
  }
}

function mat4Mul(A, oa, B, ob, C, oc) {
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      C[oc + r * 4 + c] =
        A[oa + r * 4] * B[ob + c] +
        A[oa + r * 4 + 1] * B[ob + 4 + c] +
        A[oa + r * 4 + 2] * B[ob + 8 + c] +
        A[oa + r * 4 + 3] * B[ob + 12 + c]
    }
  }
}

function composeWorld(local, parents, J, world) {
  for (let j = 0; j < J; j += 1) {
    const p = parents[j]
    const lo = j * 16
    if (p === j || p >= j) {
      world.set(local.subarray(lo, lo + 16), lo)
    } else {
      mat4Mul(world, p * 16, local, lo, world, lo)
    }
  }
}

function applyMorph(morphed, bs, assets) {
  const { morphCount, morphVidx, morphDelta, morphChan } = assets
  for (let i = 0; i < morphCount; i += 1) {
    const vi = morphVidx[i]
    const w = bs[morphChan[i]]
    const di = i * 3
    const pi = vi * 3
    morphed[pi] += morphDelta[di] * w
    morphed[pi + 1] += morphDelta[di + 1] * w
    morphed[pi + 2] += morphDelta[di + 2] * w
  }
}

function skinVertices(morphed, assets, skinMats, out) {
  const { V, K, skinW, skinJi } = assets
  out.fill(0)
  const ph = new Float32Array(4)
  const tmp = new Float32Array(3)
  for (let v = 0; v < V; v += 1) {
    const pi = v * 3
    ph[0] = morphed[pi]; ph[1] = morphed[pi + 1]; ph[2] = morphed[pi + 2]; ph[3] = 1
    for (let k = 0; k < K; k += 1) {
      const w = skinW[v * K + k]
      if (w === 0) continue
      const m = skinJi[v * K + k] * 16
      tmp[0] = skinMats[m] * ph[0] + skinMats[m + 1] * ph[1] + skinMats[m + 2] * ph[2] + skinMats[m + 3] * ph[3]
      tmp[1] = skinMats[m + 4] * ph[0] + skinMats[m + 5] * ph[1] + skinMats[m + 6] * ph[2] + skinMats[m + 7] * ph[3]
      tmp[2] = skinMats[m + 8] * ph[0] + skinMats[m + 9] * ph[1] + skinMats[m + 10] * ph[2] + skinMats[m + 11] * ph[3]
      out[pi] += tmp[0] * w
      out[pi + 1] += tmp[1] * w
      out[pi + 2] += tmp[2] * w
    }
  }
}

/**
 * @param {ReturnType<import('./loadDeformStatic').parseDeformStatic>} assets
 * @param {Float32Array} bs
 * @param {Float32Array} jo
 * @param {Float32Array} out — length V*3, centered (minus assets.center)
 */
export function deformFrame(assets, bs, jo, out) {
  const { J, apj, V, parents, neutralT, neutralQ, neutralS, bindInv, neutralPos, center } = assets

  const { t: dt, q: dq, s: ds } = splitJointBuffer(jo, apj, J)
  const localT = new Float32Array(J * 3)
  const localQ = new Float32Array(J * 4)
  const localS = new Float32Array(J * 3)

  for (let j = 0; j < J; j += 1) {
    localT[j * 3] = neutralT[j * 3] + dt[j * 3]
    localT[j * 3 + 1] = neutralT[j * 3 + 1] + dt[j * 3 + 1]
    localT[j * 3 + 2] = neutralT[j * 3 + 2] + dt[j * 3 + 2]
    const [qx, qy, qz, qw] = quatMul(
      neutralQ[j * 4], neutralQ[j * 4 + 1], neutralQ[j * 4 + 2], neutralQ[j * 4 + 3],
      dq[j * 4], dq[j * 4 + 1], dq[j * 4 + 2], dq[j * 4 + 3],
    )
    localQ[j * 4] = qx; localQ[j * 4 + 1] = qy; localQ[j * 4 + 2] = qz; localQ[j * 4 + 3] = qw
    localS[j * 3] = neutralS[j * 3] + ds[j * 3]
    localS[j * 3 + 1] = neutralS[j * 3 + 1] + ds[j * 3 + 1]
    localS[j * 3 + 2] = neutralS[j * 3 + 2] + ds[j * 3 + 2]
  }

  const local = new Float32Array(J * 16)
  const world = new Float32Array(J * 16)
  const skin = new Float32Array(J * 16)
  composeLocal(localT, localQ, localS, J, local)
  composeWorld(local, parents, J, world)

  for (let j = 0; j < J; j += 1) {
    mat4Mul(world, j * 16, bindInv, j * 16, skin, j * 16)
  }

  const morphed = new Float32Array(neutralPos)
  applyMorph(morphed, bs, assets)
  skinVertices(morphed, assets, skin, out)

  for (let i = 0; i < V * 3; i += 3) {
    out[i] -= center[0]
    out[i + 1] -= center[1]
    out[i + 2] -= center[2]
  }
}
