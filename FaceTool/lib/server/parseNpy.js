import fs from 'fs'
import path from 'path'

export const BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
]

export function loadFeatureNames(basePath) {
  if (!basePath) return null
  const p = path.join(basePath, 'feature_names.txt')
  if (!fs.existsSync(p)) return null
  return fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function metahumanNames(basePath, count = 260) {
  const fromFile = loadFeatureNames(basePath)
  if (fromFile?.length === count) return fromFile
  return Array.from({ length: count }, (_, i) => `ctrl_${i}`)
}

function toCamelArkitName(name) {
  const n = String(name || '').trim()
  if (!n || /^_?neutral$/i.test(n)) return null
  if (n[0] === n[0].toUpperCase() && /[A-Z]/.test(n.slice(1))) {
    return n.charAt(0).toLowerCase() + n.slice(1)
  }
  return n
}

/** feature_names.txt 우선, 없으면 BLENDSHAPE_NAMES (고정 인덱스 가정) */
function resolveArkitBlendshapeNames(basePath, numBlendshapes) {
  const fromFile = loadFeatureNames(basePath)
  if (fromFile?.length) {
    const names = fromFile.map(toCamelArkitName).filter(Boolean)
    if (names.length >= 51) return names.slice(0, 51)
    if (names.length === numBlendshapes || names.length === numBlendshapes - 1) {
      return names
    }
  }
  return BLENDSHAPE_NAMES
}

/** NumPy .npy buffer → JSON (ARKit 51/52, MetaHuman 260) */
export function parseNpyBuffer(buffer, basePath = '') {
  if (buffer[0] !== 0x93 || buffer.toString('ascii', 1, 6) !== 'NUMPY') {
    throw new Error('Invalid NPY file format')
  }

  const majorVersion = buffer[6]
  let headerLen
  let headerStart

  if (majorVersion === 1) {
    headerLen = buffer.readUInt16LE(8)
    headerStart = 10
  } else if (majorVersion === 2) {
    headerLen = buffer.readUInt32LE(8)
    headerStart = 12
  } else {
    throw new Error(`Unsupported NPY version: ${majorVersion}`)
  }

  const headerStr = buffer.toString('ascii', headerStart, headerStart + headerLen)
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/)
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]+)\)/)

  if (!descrMatch || !shapeMatch) {
    throw new Error('Cannot parse NPY header')
  }

  const descr = descrMatch[1]
  const shape = shapeMatch[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number)
  const isLittleEndian = descr[0] === '<' || descr[0] === '|'
  const dtypeChar = descr[1]
  const dtypeSize = parseInt(descr.slice(2), 10)
  const dataStart = headerStart + headerLen
  const dataBuffer = buffer.slice(dataStart)
  const numElements = shape.reduce((a, b) => a * b, 1)
  const values = []

  if (dtypeChar === 'f') {
    for (let i = 0; i < numElements; i += 1) {
      const offset = i * dtypeSize
      if (dtypeSize === 4) {
        values.push(isLittleEndian ? dataBuffer.readFloatLE(offset) : dataBuffer.readFloatBE(offset))
      } else if (dtypeSize === 8) {
        values.push(isLittleEndian ? dataBuffer.readDoubleLE(offset) : dataBuffer.readDoubleBE(offset))
      }
    }
  } else {
    throw new Error(`Unsupported dtype: ${descr}`)
  }


  if (shape.length === 2) {
    const [numFrames, numBlendshapes] = shape

    if (numBlendshapes === 260) {
      const featureNames = metahumanNames(basePath, 260)
      const data = []
      for (let i = 0; i < numFrames; i += 1) {
        const row = []
        for (let j = 0; j < 260; j += 1) {
          row.push(values[i * numBlendshapes + j] ?? 0)
        }
        data.push(row)
      }
      return {
        totalFrames: numFrames,
        blendshapeNames: featureNames,
        featureNames,
        data,
        channels: 260,
        outputKind: 'metahuman_260',
        fps: 30,
        shape,
        dtype: descr,
      }
    }

    const arkitNames = resolveArkitBlendshapeNames(basePath, numBlendshapes)
    const skipNeutral =
      numBlendshapes === 52 ||
      (loadFeatureNames(basePath)?.some((n) => /^_?neutral$/i.test(String(n).trim())) ?? false)
    const count = Math.min(arkitNames.length, skipNeutral ? numBlendshapes - 1 : numBlendshapes)

    const data = []
    const frames = []
    for (let i = 0; i < numFrames; i += 1) {
      const row = []
      const frameData = { frame: i }
      for (let j = 0; j < count; j += 1) {
        const npyIdx = skipNeutral ? j + 1 : j
        const valueIdx = i * numBlendshapes + npyIdx
        const v = valueIdx < values.length ? values[valueIdx] : 0
        row.push(v)
        frameData[arkitNames[j]] = v
      }
      data.push(row)
      frames.push(frameData)
    }
    return {
      totalFrames: numFrames,
      blendshapeNames: arkitNames.slice(0, count),
      featureNames: arkitNames.slice(0, count),
      data,
      frames,
      channels: count,
      outputKind: 'arkit_51',
      fps: 30,
      shape,
      dtype: descr,
    }
  }

  if (shape.length === 1) {
    const n = shape[0]
    if (n === 260) {
      const featureNames = metahumanNames(basePath, 260)
      return {
        totalFrames: 1,
        blendshapeNames: featureNames,
        featureNames,
        data: [values.slice(0, 260)],
        channels: 260,
        outputKind: 'metahuman_260',
        fps: 30,
        shape,
        dtype: descr,
      }
    }
    const frameData = { frame: 0 }
    const arkitNames = resolveArkitBlendshapeNames(basePath, n)
    const skipNeutral =
      n === 52 ||
      (loadFeatureNames(basePath)?.some((name) => /^_?neutral$/i.test(String(name).trim())) ?? false)
    const count = Math.min(arkitNames.length, skipNeutral ? n - 1 : n)
    const row = []
    for (let j = 0; j < count; j += 1) {
      const npyIdx = skipNeutral ? j + 1 : j
      const v = npyIdx < n ? values[npyIdx] : 0
      row.push(v)
      frameData[arkitNames[j]] = v
    }
    return {
      totalFrames: 1,
      blendshapeNames: arkitNames.slice(0, count),
      featureNames: arkitNames.slice(0, count),
      data: [row],
      frames: [frameData],
      channels: count,
      outputKind: 'arkit_51',
      fps: 30,
      shape,
      dtype: descr,
    }
  }

  throw new Error('Unsupported NPY shape')
}

export function parseNpyFile(filePath, basePath = '') {
  return parseNpyBuffer(fs.readFileSync(filePath), basePath)
}
