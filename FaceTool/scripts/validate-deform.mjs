import fs from 'fs'
import { parseDeformStatic } from '../lib/loadDeformStatic.js'
import { deformFrame } from '../lib/riglogicDeform.js'

const rlds = fs.readFileSync('e:/Viewer/riglogic_py/_test_rlds.bin')
const rig = JSON.parse(fs.readFileSync('e:/Viewer/riglogic_py/_test_rig.json', 'utf8'))
const golden = JSON.parse(fs.readFileSync('e:/Viewer/riglogic_py/_test_golden.json', 'utf8'))

const assets = parseDeformStatic(rlds.buffer.slice(rlds.byteOffset, rlds.byteOffset + rlds.byteLength))
const out = new Float32Array(assets.V * 3)
deformFrame(assets, new Float32Array(rig.bs), new Float32Array(rig.jo), out)

let maxErr = 0
for (let i = 0; i < 100; i += 1) {
  const e = Math.abs(out[i] - golden.v0[i])
  if (e > maxErr) maxErr = e
}
const i1000 = 1000 * 3
for (let k = 0; k < 3; k += 1) {
  const e = Math.abs(out[i1000 + k] - golden.v1000[k])
  if (e > maxErr) maxErr = e
}

console.log('V', assets.V, 'maxErr', maxErr.toFixed(6))
console.log('out sample', out[0], out[1], out[2])
console.log('golden', golden.v0[0], golden.v0[1], golden.v0[2])
if (maxErr > 0.05) process.exit(1)
