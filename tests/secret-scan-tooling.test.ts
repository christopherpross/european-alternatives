import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJsonPath = new URL('../package.json', import.meta.url)
const preCommitHookPath = new URL('../.githooks/pre-commit', import.meta.url)

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts: Record<string, string>
  }
}

describe('secret scan tooling', () => {
  it('defines install and scan scripts in package.json', () => {
    const packageJson = readPackageJson()

    expect(packageJson.scripts.prepare).toBe(
      'node scripts/install-git-hooks.mjs',
    )
    expect(packageJson.scripts['hooks:install']).toBe(
      'node scripts/install-git-hooks.mjs',
    )
    expect(packageJson.scripts['secrets:scan']).toBe(
      'node scripts/scan-secrets.mjs --tracked',
    )
    expect(packageJson.scripts['secrets:scan:staged']).toBe(
      'node scripts/scan-secrets.mjs --staged',
    )
  })

  it('runs the staged secret scan from the tracked pre-commit hook', () => {
    const hook = readFileSync(preCommitHookPath, 'utf8')

    expect(hook).toContain('npm run secrets:scan:staged')
  })
})
