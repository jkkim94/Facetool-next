import type {
  InferenceSuccessBody,
  RawInferencePayload,
} from '@/types/api'

export function normalizeInferenceResponse(
  data: RawInferencePayload
): InferenceSuccessBody {
  const blendshapes =
    data.blendshapes ??
    data.blend_shapes ??
    data.morph_targets ??
    data.blendshape_names ??
    []

  let frameData =
    data.data ??
    data.predictions ??
    data.output ??
    data.frames ??
    data.result ??
    []

  if (!Array.isArray(frameData)) {
    frameData = []
  }

  const names: string[] =
    Array.isArray(blendshapes) && blendshapes.length > 0
      ? blendshapes
      : frameData[0] &&
          typeof frameData[0] === 'object' &&
          !Array.isArray(frameData[0])
        ? Object.keys(frameData[0]).filter(
            (k) => k !== 'frame' && k !== 'time_sec'
          )
        : []

  const channelCount =
    data.channels ??
    (typeof data.frames === 'number' ? undefined : names.length) ??
    names.length

  return {
    success: true,
    blendshapes: names,
    blendshapes_glb: data.blendshapes_glb,
    data: frameData,
    fps: data.fps ?? 30,
    frames:
      typeof data.frames === 'number'
        ? data.frames
        : frameData.length,
    output_kind: data.output_kind,
    channels: data.channels ?? (names.length || channelCount || undefined),
    csvContent: data.csvContent ?? null,
    audioBase64: data.audioBase64 ?? null,
    source: data.source ?? 'backend',
  }
}
