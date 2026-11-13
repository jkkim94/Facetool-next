import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { bakeClipRoot, isClipBaked, resolveDnaProfile } from './_dnaProfiles';
import {
  bakeDir,
  datasetGenRoot,
  dnaFile,
  dnaProfileDir,
  riglogicFile,
} from '../vendorPaths';

// Baked RigLogic clip output directory (produced by riglogic_py/bake.py).
const BAKE_DIR = bakeDir();
// Source dataset with per-clip <name>.npy / .columns.txt / .wav (not vendored)
const DATASET_DIR =
  process.env.RIGLOGIC_DATASET_DIR ||
  path.join(datasetGenRoot(), 'AA_Learning_Dataset_test', 'metahuman');
const LIP_VERTICES_JSON = riglogicFile('lip_vertices.json', 'RIGLOGIC_LIP_VERTICES');
const GUI_CONTROL_VERTICES_JSON = riglogicFile(
  'gui_control_vertices.json',
  'RIGLOGIC_GUI_CONTROL_VERTICES',
);
const FACE_REGIONS_IDENTITY_JSON = riglogicFile(
  'face_regions_identity.json',
  'RIGLOGIC_FACE_REGIONS_IDENTITY',
);
const FACE_REGIONS_FACS_JSON = riglogicFile(
  'face_regions_facs.json',
  'RIGLOGIC_FACE_REGIONS_FACS',
);
const FACE_REGIONS_CREATOR_JSON = riglogicFile(
  'face_regions_creator.json',
  'RIGLOGIC_FACE_REGIONS_CREATOR',
);
const FACE_REGIONS_MESHCOLOR_JSON = riglogicFile(
  'face_regions.json',
  'RIGLOGIC_FACE_REGIONS_MESHCOLOR',
);
const REGION_UV_TEXTURE =
  process.env.RIGLOGIC_REGION_UV_TEXTURE ||
  dnaFile('0421_V33', 'T_Gray_Head_D.PNG');
const GRAY_HEAD_REGIONS_JSON = riglogicFile(
  'gray_head_regions.json',
  'RIGLOGIC_GRAY_HEAD_REGIONS',
);
const UV_MOUTH_CSV_LOD0 = riglogicFile(
  'uv_mouth_vertices_lod0.csv',
  'RIGLOGIC_UV_MOUTH_CSV',
);
// LVE lip vertex mask (MH-LVE-LIP-v1, export_lip_mask_lod0.py)
const LIP_MASK_JSON =
  process.env.RIGLOGIC_LIP_MASK ||
  dnaFile('0421_V33', 'lip_mask_v1', 'metahuman_head_lod0_lip_mask.json');
const MOUTH_REGION_MASK_JSON =
  process.env.RIGLOGIC_MOUTH_REGION_MASK ||
  dnaFile('0421_V33', 'lip_mask_v1', 'metahuman_head_lod0_mouth_region_mask.json');
const LOWER_FACE_MASK_JSON =
  process.env.RIGLOGIC_LOWER_FACE_MASK ||
  dnaFile('0421_V33', 'lip_mask_v1', 'metahuman_head_lod0_lower_face_mask.json');
const DNA_DIR = dnaProfileDir('0421_V33');
const DNA_WM_MANIFEST =
  process.env.RIGLOGIC_DNA_WM_MANIFEST ||
  path.join(DNA_DIR, 'dna_wm_masks_manifest.json');
const DNA_WM_MASKS_DIR =
  process.env.RIGLOGIC_DNA_WM_MASKS_DIR ||
  path.join(DNA_DIR, 'SourceAssets', 'masks');
/** Pipeline fixed at LOD 0 (head_lod0_mesh). */
const RIGLOGIC_LOD = 0;

function warnIfLodMismatch(requested) {
  if (requested == null || requested === '') return;
  const n = Number(requested);
  if (Number.isFinite(n) && n !== RIGLOGIC_LOD) {
    console.warn(`[riglogic] lod=${requested} ignored — using LOD ${RIGLOGIC_LOD} only`);
  }
}

function parseUvMouthCsv(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { lip: [], mouth: [], lipCount: 0, mouthCount: 0, headVertexCount: 0 };
  }
  const lip = [];
  const mouth = [];
  let maxVid = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const vid = Number.parseInt(cols[0], 10);
    const region = cols[1]?.trim();
    if (!Number.isFinite(vid)) continue;
    if (vid > maxVid) maxVid = vid;
    if (region === 'lip') lip.push(vid);
    else if (region === 'mouth') mouth.push(vid);
  }
  lip.sort((a, b) => a - b);
  mouth.sort((a, b) => a - b);
  return {
    lip,
    mouth,
    lipCount: lip.length,
    mouthCount: mouth.length,
    headVertexCount: maxVid + 1,
    lod: RIGLOGIC_LOD,
    source: 'uv_mouth_csv',
    csvPath,
  };
}

function grayHeadRegionsPath() {
  return GRAY_HEAD_REGIONS_JSON;
}

function faceRegionsPath(kind) {
  const base = path.join(
    path.dirname(FACE_REGIONS_IDENTITY_JSON),
    `face_regions_${kind}_lod${RIGLOGIC_LOD}.json`,
  );
  if (fs.existsSync(base)) return base;
  if (kind === 'identity' && fs.existsSync(FACE_REGIONS_IDENTITY_JSON)) {
    return FACE_REGIONS_IDENTITY_JSON;
  }
  if (kind === 'creator' && fs.existsSync(FACE_REGIONS_CREATOR_JSON)) {
    return FACE_REGIONS_CREATOR_JSON;
  }
  return base;
}

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.png': 'image/png',
};

function isBaked(id, profileId) {
  return isClipBaked(BAKE_DIR, profileId, id);
}

// dataset clips = every <name>.npy that has a matching .columns.txt
function listDatasetClips(profileId) {
  const pid = profileId || resolveDnaProfile().id;
  try {
    const files = fs.readdirSync(DATASET_DIR);
    const npys = files.filter((f) => f.toLowerCase().endsWith('.npy'));
    return npys
      .map((f) => f.slice(0, -4))
      .filter((id) => files.includes(`${id}.columns.txt`))
      .sort()
      .map((id) => ({ id, baked: isBaked(id, pid) }));
  } catch {
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('list') === '1') {
    const profileId = searchParams.get('dna') || searchParams.get('profile');
    return NextResponse.json({ clips: listDatasetClips(profileId) });
  }

  if (searchParams.get('lip_vertices') === '1') {
    try {
      if (!fs.existsSync(LIP_VERTICES_JSON)) {
        return NextResponse.json({ error: 'lip_vertices.json not found' }, { status: 404 });
      }
      const data = JSON.parse(fs.readFileSync(LIP_VERTICES_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('lip_mask') === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      if (!fs.existsSync(LIP_MASK_JSON)) {
        return NextResponse.json(
          {
            error:
              'metahuman_head_lod0_lip_mask.json not found — run export_lip_mask_lod0.py',
            path: LIP_MASK_JSON,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(LIP_MASK_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('mouth_region_mask') === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      if (!fs.existsSync(MOUTH_REGION_MASK_JSON)) {
        return NextResponse.json(
          {
            error: 'metahuman_head_lod0_mouth_region_mask.json not found',
            path: MOUTH_REGION_MASK_JSON,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(MOUTH_REGION_MASK_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('lower_face_mask') === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      if (!fs.existsSync(LOWER_FACE_MASK_JSON)) {
        return NextResponse.json(
          {
            error: 'metahuman_head_lod0_lower_face_mask.json not found',
            path: LOWER_FACE_MASK_JSON,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(LOWER_FACE_MASK_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('dna_wm_masks') === '1') {
    try {
      if (!fs.existsSync(DNA_WM_MANIFEST)) {
        return NextResponse.json(
          {
            error: 'dna_wm_masks_manifest.json not found — run export_dna_wm_mask_manifest.py',
            path: DNA_WM_MANIFEST,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(DNA_WM_MANIFEST, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  const wmMaskTga = searchParams.get('dna_wm_mask_tga');
  if (wmMaskTga) {
    try {
      const safe = path.basename(wmMaskTga);
      if (!safe.toLowerCase().endsWith('.tga')) {
        return NextResponse.json({ error: 'expected .tga filename' }, { status: 400 });
      }
      const filePath = path.join(DNA_WM_MASKS_DIR, safe);
      if (!filePath.startsWith(DNA_WM_MASKS_DIR) || !fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'TGA not found', path: filePath }, { status: 404 });
      }
      const buffer = fs.readFileSync(filePath);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('gui_control_vertices') === '1') {
    try {
      if (!fs.existsSync(GUI_CONTROL_VERTICES_JSON)) {
        return NextResponse.json({ error: 'gui_control_vertices.json not found' }, { status: 404 });
      }
      const data = JSON.parse(fs.readFileSync(GUI_CONTROL_VERTICES_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('region_uv_texture') === '1') {
    try {
      if (!fs.existsSync(REGION_UV_TEXTURE)) {
        return NextResponse.json(
          { error: 'T_Gray_Head_D.PNG not found', path: REGION_UV_TEXTURE },
          { status: 404 },
        );
      }
      const buffer = fs.readFileSync(REGION_UV_TEXTURE);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('uv_mouth_vertices') === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      const csvPath = UV_MOUTH_CSV_LOD0;
      if (!fs.existsSync(csvPath)) {
        return NextResponse.json(
          {
            error: 'uv_mouth_vertices CSV not found — run export_uv_mouth_vertices_csv.py --lod 0',
            path: csvPath,
          },
          { status: 404 },
        );
      }
      const data = parseUvMouthCsv(csvPath);
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (searchParams.get('gray_head_regions') === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      const jsonPath = grayHeadRegionsPath();
      if (!fs.existsSync(jsonPath)) {
        return NextResponse.json(
          {
            error: 'gray_head_regions.json not found — run export_gray_head_regions.py',
            path: jsonPath,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  const faceRegionsMode = searchParams.get('face_regions');
  if (faceRegionsMode === 'identity' || faceRegionsMode === '1') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      const jsonPath = faceRegionsPath('identity');
      if (!fs.existsSync(jsonPath)) {
        return NextResponse.json(
          {
            error: `face_regions_identity_lod${RIGLOGIC_LOD}.json not found — run export_identity_face_regions.py --lod ${RIGLOGIC_LOD}`,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (faceRegionsMode === 'facs') {
    try {
      if (!fs.existsSync(FACE_REGIONS_FACS_JSON)) {
        return NextResponse.json(
          { error: 'face_regions_facs.json not found — run export_facs_face_regions.py' },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(FACE_REGIONS_FACS_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (faceRegionsMode === 'creator') {
    try {
      warnIfLodMismatch(searchParams.get('lod'));
      const jsonPath = faceRegionsPath('creator');
      if (!fs.existsSync(jsonPath)) {
        return NextResponse.json(
          {
            error: `face_regions_creator_lod${RIGLOGIC_LOD}.json not found — run export_creator_face_regions.py --lod ${RIGLOGIC_LOD}`,
          },
          { status: 404 },
        );
      }
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  if (faceRegionsMode === 'meshcolor') {
    try {
      if (!fs.existsSync(FACE_REGIONS_MESHCOLOR_JSON)) {
        return NextResponse.json({ error: 'face_regions.json not found' }, { status: 404 });
      }
      const data = JSON.parse(fs.readFileSync(FACE_REGIONS_MESHCOLOR_JSON, 'utf8'));
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }

  const clip = searchParams.get('clip');
  const file = searchParams.get('file');
  const profileId = searchParams.get('dna') || searchParams.get('profile') || resolveDnaProfile().id;
  if (!clip || !file) {
    return NextResponse.json({ error: 'clip and file are required' }, { status: 400 });
  }

  // prevent path traversal
  const safeClip = path.basename(clip);
  const safeFile = path.basename(file);
  const clipDir = bakeClipRoot(BAKE_DIR, profileId, safeClip);
  const filePath = path.join(clipDir, safeFile);
  if (!filePath.startsWith(BAKE_DIR) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found', filePath }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const stats = fs.statSync(filePath);
  const range = request.headers.get('range');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new NextResponse(stream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': contentType,
      },
    });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': stats.size.toString(),
      'Cache-Control': 'no-cache',
    },
  });
}

