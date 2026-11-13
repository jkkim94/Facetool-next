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

const R = new Float32Array(9)
const local = new Float32Array(16)
quatToMatrix(localQ[0], localQ[1], localQ[2], localQ[3], R, 0)
const sx = localS[0]; const sy = localS[1]; const sz = localS[2]
for (let r = 0; r < 3; r += 1) {
  local[r * 4] = R[r * 3] * sx
  local[r * 4 + 1] = R[r * 3 + 1] * sy
  local[r * 4 + 2] = R[r * 3 + 2] * sz
  local[r * 4 + 3] = 0
}
local[12] = localT[0]; local[13] = localT[1]; local[14] = localT[2]; local[15] = 1
console.log('local0 row0', [...local.slice(0, 4)])
console.log('bind_inv0 row0', [...a.bindInv.slice(0, 4)])
console.log('neutralQ0', localQ[0], localQ[1], localQ[2], localQ[3])
