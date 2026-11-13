import fs from 'fs'
import path from 'path'
import { workspacePath, WORKSPACE_ROOT } from '../_config'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { sampleId, segments } = await request.json()
    if (!sampleId || !Array.isArray(segments)) {
      return Response.json({ success: false, error: 'sampleId, segments required' }, { status: 400 })
    }

    const wsDir = path.join(WORKSPACE_ROOT, 'projects')
    fs.mkdirSync(wsDir, { recursive: true })

    const wsFile = workspacePath(sampleId)
    const data = {
      sampleId,
      segments,
      savedAt: new Date().toISOString(),
      version: 1,
    }
    fs.writeFileSync(wsFile, JSON.stringify(data, null, 2), 'utf-8')

    return Response.json({ success: true, savedAt: data.savedAt })
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}
