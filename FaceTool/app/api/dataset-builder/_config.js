import path from 'path'

export const MONOINGEST_ROOT =
  (process.env.MONOINGEST_ROOT || 'E:\\MonoIngest_Chunked').replace(/\\/g, path.sep)

export const WORKSPACE_ROOT =
  (process.env.DATASET_BUILDER_WORKSPACE || 'E:\\MonoIngest_Chunked_Workspace').replace(/\\/g, path.sep)

export const SEGMENTS_ROOT =
  (process.env.DATASET_BUILDER_SEGMENTS || 'E:\\MonoIngest_Chunked_Segments').replace(/\\/g, path.sep)

export const FPS = 30

export function audioPaths(sampleId) {
  return path.join(MONOINGEST_ROOT, 'audio', `${sampleId}.wav`)
}

export function csvPath(sampleId) {
  return path.join(MONOINGEST_ROOT, 'csv', 'fps30', `${sampleId}_none_fps30.csv`)
}

export function scriptJsonPath(sampleId) {
  return path.join(MONOINGEST_ROOT, 'script_json', `${sampleId}.json`)
}

export function workspacePath(sampleId) {
  return path.join(WORKSPACE_ROOT, 'projects', `${sampleId}.segments.json`)
}

export function segmentAudioPath(segmentId) {
  return path.join(SEGMENTS_ROOT, 'audio', `${segmentId}.wav`)
}

export function segmentCsvPath(segmentId) {
  return path.join(SEGMENTS_ROOT, 'csv', 'fps30', `${segmentId}.csv`)
}

export function segmentTextPath(segmentId) {
  return path.join(SEGMENTS_ROOT, 'text', `${segmentId}.txt`)
}

export const SEGMENTS_MANIFEST = path.join(SEGMENTS_ROOT, 'manifest', 'segments.csv')
export const SEGMENTS_REJECTED = path.join(SEGMENTS_ROOT, 'manifest', 'rejected.csv')
