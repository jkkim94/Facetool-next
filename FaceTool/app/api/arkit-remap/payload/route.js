import { NextResponse } from 'next/server'
import { loadArkitRemapPayloadFromDisk, resolveArkitRemapPayloadPath } from '@/lib/arkitRemap/payloadPath'
import { validateRemapPayload } from '@/lib/arkitRemap/arkitRemap'

export async function GET() {
  try {
    const loaded = loadArkitRemapPayloadFromDisk()
    if (!loaded) {
      const searched = resolveArkitRemapPayloadPath()
      return NextResponse.json(
        {
          success: false,
          error:
            'ARKit remap payload not found. Copy AM_ArKitRemap_v02.mapping_payload.json to FaceTool/data/arkit_remap_payload.json or set ARKIT_REMAP_PAYLOAD_PATH.',
          searched: searched ?? null,
        },
        { status: 404 },
      )
    }

    if (!validateRemapPayload(loaded.payload)) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload: arkit52[] missing' },
        { status: 422 },
      )
    }

    return NextResponse.json({
      success: true,
      path: loaded.path,
      payload: loaded.payload,
      targetCount: loaded.payload.arkit52.length,
    })
  } catch (error) {
    console.error('arkit-remap/payload:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Payload load failed' },
      { status: 500 },
    )
  }
}
