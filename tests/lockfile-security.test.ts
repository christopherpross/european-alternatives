import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type SemverTuple = [number, number, number]

interface LockfilePackage {
  version?: string
}

interface Lockfile {
  packages?: Record<string, LockfilePackage>
}

const MIN_SAFE_ROLLUP_VERSION: SemverTuple = [4, 59, 0]
const lockfileUrl = new URL('../package-lock.json', import.meta.url)

function parseSemver(version: string): SemverTuple {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)

  if (!match) {
    throw new Error(`Unexpected semver format: ${version}`)
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isAtLeastVersion(version: string, minimum: SemverTuple): boolean {
  const parsed = parseSemver(version)

  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index] > minimum[index]) {
      return true
    }

    if (parsed[index] < minimum[index]) {
      return false
    }
  }

  return true
}

describe('package-lock dependency security', () => {
  it('pins rollup outside the GHSA-mw96-cpmx-2vgc vulnerable range', () => {
    const lockfile = JSON.parse(readFileSync(lockfileUrl, 'utf8')) as Lockfile
    const rollupPackage = lockfile.packages?.['node_modules/rollup']

    expect(rollupPackage?.version).toBeDefined()

    if (!rollupPackage?.version) {
      throw new Error('node_modules/rollup is missing from package-lock.json')
    }

    expect(isAtLeastVersion(rollupPackage.version, MIN_SAFE_ROLLUP_VERSION)).toBe(
      true,
    )
  })
})
