/**
 * Resolve bundled vendor paths for Facetool-next layout:
 *   <repo>/FaceTool/          (Next cwd)
 *   <repo>/vendor/riglogic_py
 *   <repo>/vendor/DNA/...
 *
 * Env overrides always win. Falls back to legacy E:\Viewer\* only if vendor is missing.
 */
import fs from 'fs'
import path from 'path'

const TRUTHY = new Set(['1', 'true', 'yes'])

function envPath(name) {
  const v = process.env[name]?.trim()
  return v || null
}

/** Repo root: parent of FaceTool when running `npm run dev` from FaceTool/ */
export function getRepoRoot() {
  const fromEnv = envPath('FACETOOL_REPO_ROOT')
  if (fromEnv) return path.resolve(fromEnv)
  const cwd = process.cwd()
  const parent = path.resolve(cwd, '..')
  if (fs.existsSync(path.join(parent, 'vendor'))) return parent
  if (fs.existsSync(path.join(cwd, 'vendor'))) return cwd
  return parent
}

export function vendorPath(...parts) {
  return path.join(getRepoRoot(), 'vendor', ...parts)
}

export function riglogicPyDir() {
  return envPath('RIGLOGIC_PY_DIR') || vendorPath('riglogic_py')
}

export function dnaProfileDir(profileId = '0421_V33') {
  const base = envPath('RIGLOGIC_DNA_DIR')
  if (base && profileId === path.basename(base)) return base
  if (base && !profileId) return base
  return vendorPath('DNA', profileId)
}

export function defaultDnaHead(profileId = '0421_V33') {
  return envPath('RIGLOGIC_DNA') || path.join(dnaProfileDir(profileId), 'head.dna')
}

export function defaultDnaMaps(profileId = '0421_V33') {
  return envPath('RIGLOGIC_MAPS') || path.join(dnaProfileDir(profileId), 'Maps')
}

export function bakeDir() {
  return (
    envPath('RIGLOGIC_BAKE_DIR') ||
    path.join(riglogicPyDir(), 'bake_out')
  )
}

export function riglogicFile(name, envName) {
  if (envName) {
    const e = envPath(envName)
    if (e) return e
  }
  return path.join(riglogicPyDir(), name)
}

export function dnaFile(profileId, ...parts) {
  return path.join(dnaProfileDir(profileId), ...parts)
}

/** Optional local dataset roots (not vendored). */
export function datasetGenRoot() {
  return envPath('DATASET_GEN_ROOT') || 'E:\\DatasetGen'
}

export function resultsBasePath() {
  return envPath('RESULTS_BASE_PATH') || 'E:\\'
}

export function isTruthyEnv(name) {
  const v = process.env[name]?.trim().toLowerCase()
  return v !== undefined && TRUTHY.has(v)
}
