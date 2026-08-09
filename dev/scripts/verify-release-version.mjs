/**
 * verify-release-version.mjs
 *
 * Ensures the Git tag matches dev/desktop/package.json version before a release
 * build. Intended for CI (Phase 4) and usable locally.
 *
 * Usage:
 *   node scripts/verify-release-version.mjs [vX.Y.Z]
 *
 * With no argument the nearest `v*` tag is read via git describe.
 */
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')
const desktopPkg = JSON.parse(
  readFileSync(join(devRoot, 'desktop', 'package.json'), 'utf-8'),
)

const argTag = process.argv[2]
const tag = argTag || (() => {
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
})()

if (!tag) {
  console.error('[verify-release-version] no tag found (no arg, no git tag)')
  process.exit(1)
}

const expected = `v${desktopPkg.version}`
if (tag !== expected) {
  console.error(
    `[verify-release-version] MISMATCH: tag "${tag}" != desktop version "${expected}"`,
  )
  process.exit(1)
}
console.log(`[verify-release-version] OK: ${tag} matches desktop/package.json version`)
