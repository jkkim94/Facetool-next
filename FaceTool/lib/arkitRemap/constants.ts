/** UE ARKit Remap payload target names (PascalCase, 52 incl. TongueOut) */
export const ARKIT_52_NAMES = [
  'EyeBlinkLeft', 'EyeLookDownLeft', 'EyeLookInLeft', 'EyeLookOutLeft',
  'EyeLookUpLeft', 'EyeSquintLeft', 'EyeWideLeft', 'EyeBlinkRight',
  'EyeLookDownRight', 'EyeLookInRight', 'EyeLookOutRight', 'EyeLookUpRight',
  'EyeSquintRight', 'EyeWideRight', 'JawForward', 'JawLeft', 'JawRight',
  'JawOpen', 'MouthClose', 'MouthFunnel', 'MouthPucker', 'MouthLeft',
  'MouthRight', 'MouthSmileLeft', 'MouthSmileRight', 'MouthFrownLeft',
  'MouthFrownRight', 'MouthDimpleLeft', 'MouthDimpleRight',
  'MouthStretchLeft', 'MouthStretchRight', 'MouthRollLower',
  'MouthRollUpper', 'MouthShrugLower', 'MouthShrugUpper', 'MouthPressLeft',
  'MouthPressRight', 'MouthLowerDownLeft', 'MouthLowerDownRight',
  'MouthUpperUpLeft', 'MouthUpperUpRight', 'BrowDownLeft', 'BrowDownRight',
  'BrowInnerUp', 'BrowOuterUpLeft', 'BrowOuterUpRight', 'CheekPuff',
  'CheekSquintLeft', 'CheekSquintRight', 'NoseSneerLeft', 'NoseSneerRight',
  'TongueOut',
] as const

/** GLB face.glb morph names (camelCase, 51 — TongueOut 없음) */
export const GLB_ARKIT_NAMES = [
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
] as const

/** PascalCase ARKit → GLB camelCase */
export function arkitToGlbName(pascal: string): string {
  if (!pascal) return pascal
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** GLB에 있는 타깃만 (TongueOut 제외) */
export function pascalTargetsForGlb(): string[] {
  const glbSet = new Set<string>(GLB_ARKIT_NAMES)
  return ARKIT_52_NAMES.filter((n) => glbSet.has(arkitToGlbName(n)))
}
