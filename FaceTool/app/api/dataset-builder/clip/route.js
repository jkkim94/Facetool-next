import fs from 'fs'
import { audioPaths, csvPath, scriptJsonPath, workspacePath, FPS } from '../_config'

export const dynamic = 'force-dynamic'

function parseScript(data) {
  if (data.spoken_script) {
    const sentences = data.spoken_script.split(/(?<=[.!?…])\s+/).filter(s => s.trim())
    const subtitleLines = data.subtitle_lines
      ? data.subtitle_lines.split('\n').filter(l => l.trim())
      : []
    return { sentences, subtitleLines, isPreset: false, newsTitle: data.news_title || '' }
  }
  return { sentences: [], subtitleLines: [], isPreset: true, newsTitle: '' }
}

function loadJawOpen(filePath) {
  if (!fs.existsSync(filePath)) return []
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  if (!lines[0]) return []
  const headers = lines[0].split(',')
  const jawIdx = headers.indexOf('jawOpen')
  if (jawIdx < 0) return []
  const values = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = lines[i].split(',')
    values.push(parseFloat(cols[jawIdx]) || 0)
  }
  return values
}

// Find initial segment boundaries using character-proportional split
// then snap to nearest jawOpen silence within ±2s window
function autoSegment(sentences, jawOpen, totalFrames, fps) {
  if (sentences.length === 0) return []
  if (sentences.length === 1 || jawOpen.length === 0) {
    return sentences.map((text, i) => ({
      id: `sent${String(i).padStart(3, '0')}`,
      sentenceIndex: i,
      text,
      startSec: 0,
      endSec: totalFrames / fps,
      startFrame: 0,
      endFrame: totalFrames,
      status: 'draft',
      source: 'auto',
    }))
  }

  const totalChars = sentences.reduce((a, s) => a + s.length, 0)
  const duration = totalFrames / fps

  // Build cumulative character ratios for boundaries
  const boundaries = [0]
  let cum = 0
  for (let i = 0; i < sentences.length - 1; i++) {
    cum += sentences[i].length
    const expectedSec = (cum / totalChars) * duration
    // Snap to silence in ±60 frames window
    const windowFrames = Math.round(fps * 1.5)
    const centerFrame = Math.round(expectedSec * fps)
    const lo = Math.max(0, centerFrame - windowFrames)
    const hi = Math.min(jawOpen.length - 1, centerFrame + windowFrames)

    let bestFrame = centerFrame
    let bestScore = Infinity
    for (let f = lo; f <= hi; f++) {
      // Prefer low jawOpen + close to expected
      const distPenalty = Math.abs(f - centerFrame) / windowFrames
      const score = jawOpen[f] + distPenalty * 0.3
      if (score < bestScore) {
        bestScore = score
        bestFrame = f
      }
    }
    boundaries.push(bestFrame)
  }
  boundaries.push(totalFrames)

  return sentences.map((text, i) => ({
    id: `sent${String(i).padStart(3, '0')}`,
    sentenceIndex: i,
    text,
    startSec: Math.round((boundaries[i] / fps) * 1000) / 1000,
    endSec: Math.round((boundaries[i + 1] / fps) * 1000) / 1000,
    startFrame: boundaries[i],
    endFrame: boundaries[i + 1],
    status: 'draft',
    source: 'auto',
  }))
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ success: false, error: 'id required' }, { status: 400 })

  const audioFile = audioPaths(id)
  const csv = csvPath(id)
  const scriptFile = scriptJsonPath(id)
  const wsFile = workspacePath(id)

  if (!fs.existsSync(audioFile)) {
    return Response.json({ success: false, error: `audio 없음: ${id}` }, { status: 404 })
  }

  const jawOpen = loadJawOpen(csv)
  const frameCount = jawOpen.length
  const durationSec = frameCount / FPS

  let scriptData = { sentences: [], subtitleLines: [], isPreset: false, newsTitle: id }
  if (fs.existsSync(scriptFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(scriptFile, 'utf-8'))
      scriptData = parseScript(raw)
    } catch {}
  }

  // Load workspace or generate auto segments
  let segments = null
  if (fs.existsSync(wsFile)) {
    try {
      const ws = JSON.parse(fs.readFileSync(wsFile, 'utf-8'))
      segments = ws.segments || null
    } catch {}
  }
  if (!segments) {
    const senList = scriptData.isPreset ? ['(preset — 전체 클립)'] : scriptData.sentences
    segments = autoSegment(senList, jawOpen, frameCount, FPS)
  }

  // Downsample jawOpen for transfer (max 2000 points)
  const step = Math.max(1, Math.floor(jawOpen.length / 2000))
  const jawSampled = []
  for (let i = 0; i < jawOpen.length; i += step) jawSampled.push(jawOpen[i])

  return Response.json({
    success: true,
    sampleId: id,
    newsTitle: scriptData.newsTitle,
    sentences: scriptData.sentences,
    subtitleLines: scriptData.subtitleLines,
    isPreset: scriptData.isPreset,
    hasScript: fs.existsSync(scriptFile),
    durationSec,
    frameCount,
    fps: FPS,
    jawOpen: jawSampled,
    jawOpenStep: step,
    segments,
    audioUrl: `/api/dataset-builder/audio?id=${encodeURIComponent(id)}`,
  })
}
