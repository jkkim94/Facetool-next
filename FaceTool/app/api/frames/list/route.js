/**
 * 프레임 폴더 목록 API
 * GET /api/frames/list?folder=train|val|test&basePath=E:\DatasetGen
 * folder가 train|val|test일 때: 해당 split 내 {name}_frames 클립 목록 반환 (clips).
 * 그 외: 해당 폴더 내 이미지 파일 목록 반환 (files).
 */

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const DEFAULT_DATASET_DIR = 'E:\\DatasetGen';
const FRAMES_DIR = 'E:\\DatasetGen\\LipReading_Dataset_Frames';
const FRAME_SPLITS = ['train', 'val', 'test'];
const LANDMARK_SAMPLES_DIR = 'landmark_samples';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawBasePath = searchParams.get('basePath') || DEFAULT_DATASET_DIR;
    const folder = searchParams.get('folder') || 'train';

    const framesRoot = fs.existsSync(FRAMES_DIR)
      ? FRAMES_DIR
      : path.join(rawBasePath, 'LipReading_Dataset_Frames');
    const targetDir = path.join(framesRoot, folder);

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return NextResponse.json({
        basePath: rawBasePath,
        folder,
        dir: targetDir,
        files: [],
        clips: [],
        error: 'Folder not found',
      });
    }

    const isSplitFolder = FRAME_SPLITS.includes(folder) || folder === LANDMARK_SAMPLES_DIR;

    if (isSplitFolder) {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const clips = [];
      for (const e of entries) {
        if (e.isDirectory() && e.name.endsWith('_frames')) {
          const name = e.name.replace(/_frames$/, '');
          const fullPath = path.join(targetDir, e.name);
          try {
            const imgs = fs.readdirSync(fullPath).filter((f) =>
              /\.(png|jpg|jpeg)$/i.test(path.extname(f))
            );
            if (imgs.length > 0) {
              clips.push({ name, path: fullPath, frameCount: imgs.length });
            }
          } catch { /* ignore */ }
        }
      }
      clips.sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({
        basePath: rawBasePath,
        folder,
        dir: targetDir,
        files: [],
        clips,
      });
    }

    const names = fs.readdirSync(targetDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.png' || ext === '.jpg' || ext === '.jpeg';
    });
    names.sort();

    const baseUrl = '/api/file';
    const files = names.map((name) => ({
      name,
      url: `${baseUrl}?fileDir=${encodeURIComponent(targetDir)}&name=${encodeURIComponent(name)}&type=image`,
    }));

    return NextResponse.json({
      basePath: rawBasePath,
      folder,
      dir: targetDir,
      files,
      clips: [],
    });
  } catch (err) {
    console.error('Frames list error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
