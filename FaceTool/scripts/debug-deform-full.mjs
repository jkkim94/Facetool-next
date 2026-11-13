import fs from 'fs'
import { parseDeformStatic } from '../lib/loadDeformStatic.js'

const rig = JSON.parse(fs.readFileSync('e:/Viewer/riglogic_py/_test_rig.json', 'utf8'))
const a = parseDeformStatic(fs.readFileSync('e:/Viewer/riglogic_py/_test_rlds.bin').buffer)
const jo = new Float32Array(rig.jo)
const J = a.J
const apj = a.apj

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
    local[o + 3] = trans[j * 3]
    local[o + 7] = trans[j * 3 + 1]
    local[o + 11] = trans[j * 3 + 2]
    local[o + 12] = 0
    local[o + 13] = 0
    local[o + 14] = 0
    local[o + 15] = 1
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

const dt = new Float32Array(J * 3)
const dq = new Float32Array(J * 4)
const ds = new Float32Array(J * 3)
for (let j = 0; j < J; j += 1) {
  const b = j * apj
  dt[j * 3] = jo[b]; dt[j * 3 + 1] = jo[b + 1]; dt[j * 3 + 2] = jo[b + 2]
  dq[j * 4] = jo[b + 3]; dq[j * 4 + 1] = jo[b + 4]; dq[j * 4 + 2] = jo[b + 5]; dq[j * 4 + 3] = jo[b + 6]
  ds[j * 3] = jo[b + 7]; ds[j * 3 + 1] = jo[b + 8]; ds[j * 3 + 2] = jo[b + 9]
}

const localT = new Float32Array(J * 3)
const localQ = new Float32Array(J * 4)
const localS = new Float32Array(J * 3)
for (let j = 0; j < J; j += 1) {
  localT[j * 3] = a.neutralT[j * 3] + dt[j * 3]
  localT[j * 3 + 1] = a.neutralT[j * 3 + 1] + dt[j * 3 + 1]
  localT[j * 3 + 2] = a.neutralT[j * 3 + 2] + dt[j * 3 + 2]
  const [qx, qy, qz, qw] = quatMul(
    a.neutralQ[j * 4], a.neutralQ[j * 4 + 1], a.neutralQ[j * 4 + 2], a.neutralQ[j * 4 + 3],
    dq[j * 4], dq[j * 4 + 1], dq[j * 4 + 2], dq[j * 4 + 3],
  )
  localQ[j * 4] = qx; localQ[j * 4 + 1] = qy; localQ[j * 4 + 2] = qz; localQ[j * 4 + 3] = qw
  localS[j * 3] = a.neutralS[j * 3] + ds[j * 3]
  localS[j * 3 + 1] = a.neutralS[j * 3 + 1] + ds[j * 3 + 1]
  localS[j * 3 + 2] = a.neutralS[j * 3 + 2] + ds[j * 3 + 2]
}

const local = new Float32Array(J * 16)
const world = new Float32Array(J * 16)
const skin = new Float32Array(J * 16)
composeLocal(localT, localQ, localS, J, local)
composeWorld(local, a.parents, J, world)
for (let j = 0; j < J; j += 1) {
  mat4Mul(world, j * 16, a.bindInv, j * 16, skin, j * 16)
}

console.log('local0 row0', [...local.slice(0, 4)])
console.log('skin0 row0', [...skin.slice(0, 4)])

const ph = [a.neutralPos[0], a.neutralPos[1], a.neutralPos[2], 1]
const ji0 = a.skinJi[0]
const w0 = a.skinW[0]
let x = 0; let y = 0; let z = 0
for (let k = 0; k < a.K; k += 1) {
  const w = a.skinW[k]
  if (w === 0) continue
  const m = a.skinJi[k] * 16
  const tx = skin[m] * ph[0] + skin[m + 1] * ph[1] + skin[m + 2] * ph[2] + skin[m + 3] * ph[3]
  const ty = skin[m + 4] * ph[0] + skin[m + 5] * ph[1] + skin[m + 6] * ph[2] + skin[m + 7] * ph[3]
  const tz = skin[m + 8] * ph[0] + skin[m + 9] * ph[1] + skin[m + 10] * ph[2] + skin[m + 11] * ph[3]
  x += tx * w; y += ty * w; z += tz * w
}
console.log('v0 raw', x, y, z)
console.log('v0 centered', x - a.center[0], y - a.center[1], z - a.center[2])
console.log('golden', -1.5609751, 0.99297833, 8.706164)
