/**
 * 클립별 한글 발화 텍스트(자막) API
 * - LipReading_Dataset_Transcripts와 동일한 split/클립 폴더 구조 사용
 * - GET /api/transcript?basePath=...&split=train&clip=lip_J_1_F_02_E209_A_001_004
 * - basePath 기준으로 Transcripts 폴더 탐색, 없으면 E:\DatasetGen\LipReading_Dataset_Transcripts 사용
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const FALLBACK_TRANSCRIPTS_ROOT = 'E:\\DatasetGen\\LipReading_Dataset_Transcripts';
const TRANSCRIPTS_DIR_NAME = 'LipReading_Dataset_Transcripts';
const SPLITS_TO_TRY = ['train', 'val', 'test', 'landmark_samples'];

function resolveTranscriptsRoot(basePath) {
  if (!basePath) return FALLBACK_TRANSCRIPTS_ROOT;
  const normalized = path.normalize(basePath.replace(/\//g, path.sep));
  const byBase = path.join(normalized, TRANSCRIPTS_DIR_NAME);
  if (fs.existsSync(byBase) && fs.statSync(byBase).isDirectory()) {
    return byBase;
  }
  return FALLBACK_TRANSCRIPTS_ROOT;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const basePath = searchParams.get('basePath') || 'E:\\DatasetGen';
  const split = searchParams.get('split') || '';
  const clip = searchParams.get('clip') || '';

  if (!clip.trim()) {
    return NextResponse.json({ ok: false, text: null, error: 'clip required' }, { status: 400 });
  }

  const clipFolder = clip.endsWith('_frames') ? clip : `${clip}_frames`;
  const root = resolveTranscriptsRoot(basePath);

  const candidates = [];
  if (split) {
    candidates.push(path.join(root, split, clipFolder, 'transcript.txt'));
  }
  for (const s of SPLITS_TO_TRY) {
    if (s !== split) candidates.push(path.join(root, s, clipFolder, 'transcript.txt'));
  }

  try {
    for (const transcriptPath of candidates) {
      if (fs.existsSync(transcriptPath)) {
        const text = fs.readFileSync(transcriptPath, 'utf-8').trim();
        return NextResponse.json({ ok: true, text });
      }
    }
    return NextResponse.json({ ok: false, text: null, error: 'not_found' });
  } catch (err) {
    console.error('[transcript]', candidates[0], err.message);
    return NextResponse.json({ ok: false, text: null, error: err.message }, { status: 500 });
  }
}
