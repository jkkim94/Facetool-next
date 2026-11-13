import fs from 'fs'
import { audioPaths } from '../_config'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return new Response('id required', { status: 400 })

  const filePath = audioPaths(id)
  if (!fs.existsSync(filePath)) {
    return new Response('audio not found', { status: 404 })
  }

  const stat = fs.statSync(filePath)
  const stream = fs.createReadStream(filePath)

  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  })
}
