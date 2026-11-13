import { NextResponse } from 'next/server'
import { parseNpyBuffer } from '@/lib/server/parseNpy'

export async function POST(request) {
  try {
    const form = await request.formData()
    const npy = form.get('npy')
    const featureRoot = String(form.get('featureRoot') || '').trim()

    if (!npy || typeof npy === 'string') {
      return NextResponse.json({ error: 'npy file required' }, { status: 400 })
    }

    const buffer = Buffer.from(await npy.arrayBuffer())
    const data = parseNpyBuffer(buffer, featureRoot)
    return NextResponse.json(data)
  } catch (error) {
    console.error('parse-npy:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
