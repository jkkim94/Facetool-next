import fs from 'fs'
import path from 'path'
import { MONOINGEST_ROOT, csvPath, scriptJsonPath, workspacePath } from '../_config'

export const dynamic = 'force-dynamic'

function countCsvFrames(filePath) {
  if (!fs.existsSync(filePath)) return 0
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('frame'))
  return lines.length
}

function loadScriptMeta(jsonPath) {
  if (!fs.existsSync(jsonPath)) return null
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    const isPreset = !data.spoken_script && !!data.performance_sequence
    const sentences = data.spoken_script
      ? data.spoken_script.split(/(?<=[.!?…])\s+/).filter(s => s.trim())
      : []
    return {
      newsTitle: data.news_title || '',
      sentenceCount: isPreset ? 1 : sentences.length,
      isPreset,
    }
  } catch {
    return null
  }
}

function loadWorkspaceStatus(wsPath) {
  if (!fs.existsSync(wsPath)) return { status: 'unset', approvedCount: 0, totalSegments: 0 }
  try {
    const ws = JSON.parse(fs.readFileSync(wsPath, 'utf-8'))
    const segs = ws.segments || []
    const approved = segs.filter(s => s.status === 'approved').length
    return {
      status: approved === segs.length && segs.length > 0 ? 'done' : segs.length > 0 ? 'in_progress' : 'unset',
      approvedCount: approved,
      totalSegments: segs.length,
    }
  } catch {
    return { status: 'error', approvedCount: 0, totalSegments: 0 }
  }
}

export async function GET() {
  const audioDir = path.join(MONOINGEST_ROOT, 'audio')
  if (!fs.existsSync(audioDir)) {
    return Response.json({ success: false, error: `audio 폴더 없음: ${audioDir}` }, { status: 500 })
  }

  const wavFiles = fs.readdirSync(audioDir).filter(f => f.endsWith('.wav')).sort()

  const clips = wavFiles.map(fname => {
    const sampleId = fname.replace('.wav', '')
    const frames = countCsvFrames(csvPath(sampleId))
    const scriptMeta = loadScriptMeta(scriptJsonPath(sampleId))
    const ws = loadWorkspaceStatus(workspacePath(sampleId))

    return {
      sampleId,
      newsTitle: scriptMeta?.newsTitle || '',
      durationSec: frames > 0 ? Math.round((frames / 30) * 10) / 10 : 0,
      frameCount: frames,
      sentenceCount: scriptMeta?.sentenceCount || 0,
      isPreset: scriptMeta?.isPreset || false,
      hasScript: scriptMeta !== null,
      workspaceStatus: ws.status,
      approvedCount: ws.approvedCount,
      totalSegments: ws.totalSegments,
    }
  })

  return Response.json({ success: true, clips, root: MONOINGEST_ROOT })
}
