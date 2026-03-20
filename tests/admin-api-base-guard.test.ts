import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectDir = resolve('.')
const guardPath = resolve('scripts/lib/api-base-guard.sh')
const researchScriptPath = resolve('scripts/research-alternative.sh')
const researchMinimaxScriptPath = resolve('scripts/research-alternative-minimax.sh')

function runGuard(apiBase: string) {
  return spawnSync(
    'bash',
    [
      '-lc',
      'source "$GUARD_PATH"; validate_api_base "$API_BASE_UNDER_TEST"',
    ],
    {
      cwd: projectDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        API_BASE_UNDER_TEST: apiBase,
        GUARD_PATH: guardPath,
      },
    },
  )
}

function runScript(scriptPath: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  })
}

describe('admin API base guard', () => {
  it('normalizes secure origins and strips a trailing slash', () => {
    const result = runGuard('https://european-alternatives.cloud/')

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('https://european-alternatives.cloud')
    expect(result.stderr).toBe('')
  })

  it('allows loopback http origins for local development', () => {
    for (const apiBase of [
      'http://localhost:5173/',
      'http://dev.localhost:8080',
      'http://127.0.0.1:9000',
      'http://[::1]:8443/',
    ]) {
      const result = runGuard(apiBase)

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim()).toBe(apiBase.replace(/\/$/, ''))
    }
  })

  it('rejects insecure remote http origins', () => {
    const result = runGuard('http://european-alternatives.cloud')

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('must use https:// for non-local targets')
  })

  it('rejects API bases that include a path instead of a bare origin', () => {
    const result = runGuard('https://european-alternatives.cloud/api')

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('must be an origin only')
  })
})

describe('research script entrypoints', () => {
  // These scripts are gitignored (local-only tooling) and do not exist in CI.
  const scriptsExist = [researchScriptPath, researchMinimaxScriptPath].every(
    (p) => { try { readFileSync(p); return true } catch { return false } },
  )

  it.skipIf(!scriptsExist)('shows --help for both research scripts without failing on a missing guard file', () => {
    for (const scriptPath of [researchScriptPath, researchMinimaxScriptPath]) {
      const result = runScript(scriptPath, ['--help'])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stderr).toBe('')
    }
  })

  it.skipIf(!scriptsExist)('fails fast on insecure remote EUROALT_API_BASE values before any admin or model work', () => {
    for (const scriptPath of [researchScriptPath, researchMinimaxScriptPath]) {
      const result = runScript(scriptPath, ['Krita', '--dry-run'], {
        EUROALT_API_BASE: 'http://example.com',
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('must use https:// for non-local targets')
      expect(result.stderr).not.toContain('No such file or directory')
      expect(result.stderr).not.toContain('codex is not installed')
      expect(result.stderr).not.toContain('MiniMax API key file not found')
    }
  })
})
