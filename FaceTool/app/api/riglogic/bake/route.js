import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { bakeClipRoot, isClipBaked, resolveDnaProfile } from '../_dnaProfiles';
import { bakeDir, datasetGenRoot, riglogicPyDir } from '../../vendorPaths';

const BAKE_DIR = bakeDir();
const DATASET_DIR =
  process.env.RIGLOGIC_DATASET_DIR ||
  path.join(datasetGenRoot(), 'AA_Learning_Dataset_test', 'metahuman');
const PYTHON = process.env.RIGLOGIC_PYTHON || 'python';
const BAKE_CWD = riglogicPyDir();

// in-flight bakes shared across requests (survives dev hot-reload via global)
const inflight = globalThis.__riglogicBakes || (globalThis.__riglogicBakes = new Map());

function runBake(id, profileId) {
  const inflightKey = `${profileId}:${id}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const profile = resolveDnaProfile(profileId);
  const npy = path.join(DATASET_DIR, `${id}.npy`);
  const cols = path.join(DATASET_DIR, `${id}.columns.txt`);
  const wav = path.join(DATASET_DIR, `${id}.wav`);
  const out = bakeClipRoot(BAKE_DIR, profile.id, id);

  const p = new Promise((resolve, reject) => {
    if (!fs.existsSync(npy) || !fs.existsSync(cols)) {
      reject(new Error('clip source files not found'));
      return;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const args = [
      'bake.py',
      '--dna', profile.dna,
      '--npy', npy,
      '--columns', cols,
      '--out', out,
      '--lod', '0',
      '--meshes', 'face',
      '--half',
      '--textures-dir', profile.maps,
    ];
    if (fs.existsSync(wav)) args.push('--wav', wav);

    const child = spawn(PYTHON, args, {
      cwd: BAKE_CWD,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(path.join(out, 'manifest.json'))) {
        resolve();
      } else {
        reject(new Error(`bake failed (code ${code})\n${stderr || stdout}`));
      }
    });
  }).finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, p);
  return p;
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const id = body.clip ? path.basename(body.clip) : null;
  const profileId = body.dnaProfile ? path.basename(body.dnaProfile) : resolveDnaProfile().id;
  if (!id) return NextResponse.json({ error: 'clip required' }, { status: 400 });

  const manifestPath = path.join(bakeClipRoot(BAKE_DIR, profileId, id), 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    return NextResponse.json({ ok: true, cached: true, dnaProfile: profileId });
  }

  try {
    await runBake(id, profileId);
    return NextResponse.json({ ok: true, cached: false, dnaProfile: profileId });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
