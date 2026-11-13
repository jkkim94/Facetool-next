import fs from 'fs'
import path from 'path'
import {
  audioPaths, csvPath, workspacePath,
  segmentAudioPath, segmentCsvPath, segmentTextPath,
  SEGMENTS_ROOT, SEGMENTS_MANIFEST, SEGMENTS_REJECTED, FPS,
} from '../_config'

export const dynamic = 'force-dynamic'

// ------- WAV crop (pure Node.js) -------
function parseWavInfo(buf) {
  let channels = 1, sampleRate = 44100, bitsPerSample = 16, dataOffset = 44, dataSize = buf.length - 44
  let pos = 12
  while (pos < buf.length - 8) {
    const id = buf.slice(pos, pos + 4).toString('ascii')
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(pos + 10)
      sampleRate = buf.readUInt32LE(pos + 12)
      bitsPerSample = buf.readUInt16LE(pos + 22)
    } else if (id === 'data') {
      dataOffset = pos + 8
      dataSize = size
      break
    }
    pos += 8 + (size % 2 === 0 ? size : size + 1)
  }
  return { channels, sampleRate, bitsPerSample, dataOffset, dataSize }
}

function cropWav(srcBuf, startSec, endSec) {
  const { channels, sampleRate, bitsPerSample, dataOffset } = parseWavInfo(srcBuf)
  const bytesPerSample = (bitsPerSample / 8) * channels
  const startByte = Math.floor(startSec * sampleRate) * bytesPerSample
  const endByte = Math.ceil(endSec * sampleRate) * bytesPerSample
  const dataSlice = srcBuf.slice(dataOffset + startByte, dataOffset + endByte)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSlice.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * bitsPerSample / 8, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSlice.length, 40)
  return Buffer.concat([header, dataSlice])
}

// ------- CSV crop -------
function cropCsv(srcPath, startFrame, endFrame) {
  const lines = fs.readFileSync(srcPath, 'utf-8').split('\n')
  const header = lines[0]
  const rows = lines.slice(1).filter(l => l.trim())
  const sliced = rows.slice(startFrame, endFrame)
  const renumbered = sliced.map((row, i) => {
    const cols = row.split(',')
    cols[0] = String(i)
    cols[1] = (i / FPS).toFixed(6)
    return cols.join(',')
  })
  return [header, ...renumbered].join('\n')
}

// ------- Manifest helpers -------
const MANIFEST_HEADER =
  'segment_id,parent_sample_id,sentence_index,text,audio_start_sec,audio_end_sec,' +
  'csv_start_frame,csv_end_frame,fps,duration_sec,status,source\n'

const REJECTED_HEADER =
  'segment_id,parent_sample_id,sentence_index,text,status\n'

export async function POST(request) {
  try {
    const { sampleId, segments } = await request.json()
    if (!sampleId || !Array.isArray(segments)) {
      return Response.json({ success: false, error: 'sampleId, segments required' }, { status: 400 })
    }

    const approved = segments.filter(s => s.status === 'approved')
    const rejected = segments.filter(s => s.status === 'rejected')

    if (approved.length === 0) {
      return Response.json({ success: false, error: 'approved 상태인 segment가 없습니다.' }, { status: 400 })
    }

    const srcWav = audioPaths(sampleId)
    const srcCsv = csvPath(sampleId)
    if (!fs.existsSync(srcWav)) {
      return Response.json({ success: false, error: `audio 없음: ${sampleId}` }, { status: 404 })
    }

    // Ensure output dirs
    for (const dir of [
      path.join(SEGMENTS_ROOT, 'audio'),
      path.join(SEGMENTS_ROOT, 'csv', 'fps30'),
      path.join(SEGMENTS_ROOT, 'text'),
      path.join(SEGMENTS_ROOT, 'manifest'),
    ]) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const wavBuf = fs.readFileSync(srcWav)
    const exported = []
    let manifestLines = ''
    let rejectedLines = ''

    for (const seg of approved) {
      const segId = `${sampleId}_${seg.id}`
      try {
        // WAV
        const croppedWav = cropWav(wavBuf, seg.startSec, seg.endSec)
        fs.writeFileSync(segmentAudioPath(segId), croppedWav)
        // CSV
        if (fs.existsSync(srcCsv)) {
          const croppedCsv = cropCsv(srcCsv, seg.startFrame, seg.endFrame)
          fs.writeFileSync(segmentCsvPath(segId), croppedCsv, 'utf-8')
        }
        // Text
        fs.writeFileSync(segmentTextPath(segId), seg.text || '', 'utf-8')

        const dur = Math.round((seg.endSec - seg.startSec) * 100) / 100
        manifestLines +=
          `${segId},${sampleId},${seg.sentenceIndex},"${(seg.text || '').replace(/"/g, '""')}",` +
          `${seg.startSec},${seg.endSec},${seg.startFrame},${seg.endFrame},${FPS},${dur},` +
          `${seg.status},${seg.source || 'manual'}\n`
        exported.push(segId)
      } catch (err) {
        console.error(`[export] ${segId} 실패:`, err.message)
      }
    }

    for (const seg of rejected) {
      const segId = `${sampleId}_${seg.id}`
      rejectedLines +=
        `${segId},${sampleId},${seg.sentenceIndex},"${(seg.text || '').replace(/"/g, '""')}",${seg.status}\n`
    }

    // Append to manifest
    if (manifestLines) {
      const existsManifest = fs.existsSync(SEGMENTS_MANIFEST)
      fs.appendFileSync(SEGMENTS_MANIFEST, existsManifest ? manifestLines : MANIFEST_HEADER + manifestLines)
    }
    if (rejectedLines) {
      const existsRejected = fs.existsSync(SEGMENTS_REJECTED)
      fs.appendFileSync(SEGMENTS_REJECTED, existsRejected ? rejectedLines : REJECTED_HEADER + rejectedLines)
    }

    return Response.json({
      success: true,
      exported: exported.length,
      rejected: rejected.length,
      segmentIds: exported,
    })
  } catch (err) {
    console.error('[export]', err)
    return Response.json({ success: false, error: err.message }, { status: 500 })
  }
}
