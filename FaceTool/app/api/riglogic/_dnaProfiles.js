import fs from 'fs'
import path from 'path'
import {
  defaultDnaHead,
  defaultDnaMaps,
  getRepoRoot,
  riglogicPyDir,
} from '../vendorPaths'

const PROFILES_JSON =
  process.env.RIGLOGIC_PROFILES_JSON ||
  path.join(riglogicPyDir(), 'dna_profiles.json')

let cachedConfig = null

function resolveRepoPath(value, fallback) {
  if (!value) return fallback
  if (path.isAbsolute(value)) {
    if (fs.existsSync(value)) return value
    // Legacy absolute missing → try same relative under repo if it looks like vendor/...
    const idx = value.replace(/\\/g, '/').toLowerCase().indexOf('/vendor/')
    if (idx >= 0) {
      const rel = value.replace(/\\/g, '/').slice(idx + 1)
      const candidate = path.join(getRepoRoot(), rel)
      if (fs.existsSync(candidate)) return candidate
    }
    return value
  }
  return path.resolve(getRepoRoot(), value)
}

export function loadDnaProfilesConfig() {
  if (cachedConfig) return cachedConfig
  if (!fs.existsSync(PROFILES_JSON)) {
    cachedConfig = {
      default: '0421_V33',
      profiles: [
        {
          id: '0421_V33',
          label: '0421_V33',
          dna: defaultDnaHead('0421_V33'),
          maps: defaultDnaMaps('0421_V33'),
        },
      ],
    }
    return cachedConfig
  }

  const raw = JSON.parse(fs.readFileSync(PROFILES_JSON, 'utf8'))
  cachedConfig = {
    ...raw,
    profiles: (raw.profiles || []).map((p) => {
      const id = p.id || '0421_V33'
      return {
        ...p,
        dna: resolveRepoPath(p.dna, defaultDnaHead(id)),
        maps: resolveRepoPath(p.maps, defaultDnaMaps(id)),
        region_uv_texture: p.region_uv_texture
          ? resolveRepoPath(p.region_uv_texture, null)
          : null,
        lip_mask: p.lip_mask ? resolveRepoPath(p.lip_mask, null) : null,
        mouth_region_mask: p.mouth_region_mask
          ? resolveRepoPath(p.mouth_region_mask, null)
          : null,
        lower_face_mask: p.lower_face_mask
          ? resolveRepoPath(p.lower_face_mask, null)
          : null,
      }
    }),
  }
  return cachedConfig
}

/** @param {string} [profileId] */
export function resolveDnaProfile(profileId) {
  const cfg = loadDnaProfilesConfig()
  const id = profileId || cfg.default || cfg.profiles?.[0]?.id
  const profile = cfg.profiles?.find((p) => p.id === id) || cfg.profiles?.[0]
  if (!profile) throw new Error('no DNA profile configured')
  return profile
}

/**
 * Baked clip directory for a DNA profile (legacy flat layout for default profile).
 */
export function bakeClipRoot(bakeDir, profileId, clipId) {
  const safeProfile = path.basename(profileId)
  const safeClip = path.basename(clipId)
  const profiled = path.join(bakeDir, safeProfile, safeClip)
  if (fs.existsSync(path.join(profiled, 'manifest.json'))) return profiled
  const defaultId = loadDnaProfilesConfig().default || '0421_V33'
  if (safeProfile === defaultId) {
    const legacy = path.join(bakeDir, safeClip)
    if (fs.existsSync(path.join(legacy, 'manifest.json'))) return legacy
  }
  return profiled
}

export function isClipBaked(bakeDir, profileId, clipId) {
  return fs.existsSync(
    path.join(bakeClipRoot(bakeDir, profileId, clipId), 'manifest.json'),
  )
}
