import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

const adminAuthPath = resolve('api/admin/auth.php')
const addAlternativePath = resolve('api/admin/add-alternative.php')
const denyAlternativePath = resolve('api/admin/deny-alternative.php')
const adminAuthSource = readFileSync(adminAuthPath, 'utf8')
const authRunnerCode = `<?php
declare(strict_types=1);
require ${JSON.stringify(adminAuthPath)};
requireAdminAuth();
sendJsonResponse(200, ['ok' => true]);
`
const validToken = 'b'.repeat(64)
const tempPaths: string[] = []

let phpPromise: Promise<PHP> | undefined

type AuthResponse = {
  status: number
  headers: Record<string, string[]>
  json: unknown
  stderr: string
}

type AuthRequestOptions = {
  authorization?: string
  now: number
  rateLimitDir: string
  remoteAddr?: string
  userAgent?: string
}

function createTempPath(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  tempPaths.push(path)
  return path
}

function getPhp(): Promise<PHP> {
  phpPromise ??= loadNodeRuntime('8.3').then((runtime) => {
    const php = new PHP(runtime)
    useHostFilesystem(php)
    return php
  })
  return phpPromise
}

function getStatePath(rateLimitDir: string, clientKey: string): string {
  const hashedClientKey = createHash('sha256').update(clientKey).digest('hex')
  return join(rateLimitDir, `${hashedClientKey}.json`)
}

function readRateLimitState(rateLimitDir: string, clientKey: string): {
  failures: number[]
  blocked_until: number
} | null {
  const statePath = getStatePath(rateLimitDir, clientKey)

  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as {
      failures: number[]
      blocked_until: number
    }
  } catch {
    return null
  }
}

function getHeader(headers: Record<string, string[]>, name: string): string | undefined {
  const expectedName = name.toLowerCase()

  for (const [headerName, values] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expectedName) {
      return values[0]
    }
  }

  return undefined
}

async function runPhpAuthRequest(
  code: string,
  options: AuthRequestOptions,
): Promise<AuthResponse> {
  const php = await getPhp()
  const response = await php.runStream({
    code,
    method: 'POST',
    env: {
      EUROALT_ADMIN_AUTH_NOW: String(options.now),
      EUROALT_ADMIN_RATE_LIMIT_DIR: options.rateLimitDir,
      EUROALT_ADMIN_TOKEN: validToken,
    },
    $_SERVER: {
      REMOTE_ADDR: options.remoteAddr ?? '203.0.113.7',
      ...(options.authorization === undefined
        ? {}
        : { HTTP_AUTHORIZATION: options.authorization }),
      ...(options.userAgent === undefined
        ? {}
        : { HTTP_USER_AGENT: options.userAgent }),
    },
  })

  const stdoutText = await response.stdoutText
  const stderrText = await response.stderrText

  return {
    status: await response.httpStatusCode,
    headers: await response.headers,
    json: JSON.parse(stdoutText) as unknown,
    stderr: stderrText,
  }
}

async function runAuthRequest(options: AuthRequestOptions): Promise<AuthResponse> {
  return runPhpAuthRequest(authRunnerCode, options)
}

async function runAdminEndpointRequest(
  endpointPath: string,
  options: AuthRequestOptions,
): Promise<AuthResponse> {
  return runPhpAuthRequest(
    `<?php
declare(strict_types=1);
require ${JSON.stringify(endpointPath)};
`,
    options,
  )
}

afterAll(async () => {
  if (phpPromise) {
    const php = await phpPromise
    php.exit(0)
  }

  for (const tempPath of tempPaths) {
    rmSync(tempPath, { recursive: true, force: true })
  }
})

describe('admin auth rate limiting', () => {
  it('removes sleep-based throttling and uses a private default rate-limit directory', () => {
    expect(adminAuthSource).toContain(
      "const DEFAULT_ADMIN_RATE_LIMIT_DIR = '/home/u688914453/.local/state/euroalt-admin-auth';",
    )
    expect(adminAuthSource).not.toContain('/tmp/euroalt-ratelimit/')
    expect(adminAuthSource).not.toContain('sleep(')
  })

  it('allows five failures, then returns 429 with Retry-After based on the oldest short-window failure', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.25'

    for (let offset = 0; offset < 5; offset += 1) {
      const response = await runAuthRequest({
        authorization: 'Bearer wrong-token',
        now: 1_000 + offset,
        rateLimitDir,
        remoteAddr,
      })

      expect(response.status).toBe(403)
      expect(response.json).toEqual({ ok: false, error: 'forbidden' })
    }

    const throttledResponse = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 1_005,
      rateLimitDir,
      remoteAddr,
    })

    expect(throttledResponse.status).toBe(429)
    expect(throttledResponse.json).toEqual({
      ok: false,
      error: 'too_many_auth_attempts',
    })
    expect(getHeader(throttledResponse.headers, 'Retry-After')).toBe('895')

    const state = readRateLimitState(rateLimitDir, remoteAddr)
    expect(state).not.toBeNull()
    expect(state?.failures).toHaveLength(6)
    expect(state?.blocked_until).toBe(0)
  })

  it('activates the one-hour block after twenty failures even while short-window throttling is active', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.26'

    for (let offset = 0; offset < 19; offset += 1) {
      await runAuthRequest({
        authorization: 'Bearer wrong-token',
        now: 2_000 + offset,
        rateLimitDir,
        remoteAddr,
      })
    }

    const blockResponse = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 2_019,
      rateLimitDir,
      remoteAddr,
    })

    expect(blockResponse.status).toBe(429)
    expect(blockResponse.json).toEqual({
      ok: false,
      error: 'too_many_auth_attempts',
    })
    expect(getHeader(blockResponse.headers, 'Retry-After')).toBe('3600')

    const stateAfterBlock = readRateLimitState(rateLimitDir, remoteAddr)
    expect(stateAfterBlock).not.toBeNull()
    expect(stateAfterBlock?.failures).toHaveLength(20)
    expect(stateAfterBlock?.blocked_until).toBe(5_619)

    const blockedResponse = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 2_050,
      rateLimitDir,
      remoteAddr,
    })

    expect(blockedResponse.status).toBe(429)
    expect(getHeader(blockedResponse.headers, 'Retry-After')).toBe('3569')
  })

  it('recovers from malformed state files by resetting them and recording the current failure', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.27'
    const statePath = getStatePath(rateLimitDir, remoteAddr)

    writeFileSync(statePath, '{not-json')

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 3_000,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(403)
    expect(response.json).toEqual({ ok: false, error: 'forbidden' })
    expect(readRateLimitState(rateLimitDir, remoteAddr)).toEqual({
      failures: [3_000],
      blocked_until: 0,
    })
  })

  it('clears stored failures after a successful bearer-token authentication', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.28'
    const statePath = getStatePath(rateLimitDir, remoteAddr)

    writeFileSync(
      statePath,
      JSON.stringify({
        failures: [4_000, 4_010, 4_020],
        blocked_until: 0,
      }),
    )

    const response = await runAuthRequest({
      authorization: `Bearer ${validToken}`,
      now: 4_030,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(200)
    expect(response.json).toEqual({ ok: true })
    expect(readRateLimitState(rateLimitDir, remoteAddr)).toBeNull()
  })

  it('fails closed when the configured rate-limit storage path is unusable', async () => {
    const unusablePath = createTempPath('euroalt-admin-rate-limit-file-')
    const remoteAddr = '198.51.100.29'

    rmSync(unusablePath, { recursive: true, force: true })
    writeFileSync(unusablePath, 'not a directory')
    tempPaths.push(unusablePath)

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 5_000,
      rateLimitDir: unusablePath,
      remoteAddr,
    })

    expect(response.status).toBe(503)
    expect(response.json).toEqual({
      ok: false,
      error: 'auth_rate_limit_unavailable',
    })
  })

  it('tightens directory permissions to private mode before using the limiter state', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.30'

    chmodSync(rateLimitDir, 0o755)

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 6_000,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(403)
    expect(statSync(rateLimitDir).mode & 0o777).toBe(0o700)
  })
})

describe('admin auth audit logging', () => {
  it('logs failed auth with IP, reason, and user-agent', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.40'

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 10_000,
      rateLimitDir,
      remoteAddr,
      userAgent: 'TestBot/1.0',
    })

    expect(response.status).toBe(403)
    expect(response.stderr).toContain('euroalt-admin: auth FAILED from 198.51.100.40 reason=forbidden (UA: TestBot/1.0)')
  })

  it('logs successful auth with IP', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.41'

    const response = await runAuthRequest({
      authorization: `Bearer ${validToken}`,
      now: 10_100,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(200)
    expect(response.stderr).toContain('euroalt-admin: auth OK from 198.51.100.41')
  })

  it('logs missing authorization header with correct reason', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.42'

    const response = await runAuthRequest({
      now: 10_200,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(401)
    expect(response.stderr).toContain('euroalt-admin: auth FAILED from 198.51.100.42 reason=missing_authorization')
  })

  it('logs invalid authorization scheme with correct reason', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.43'

    const response = await runAuthRequest({
      authorization: 'Basic dXNlcjpwYXNz',
      now: 10_300,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(401)
    expect(response.stderr).toContain('euroalt-admin: auth FAILED from 198.51.100.43 reason=invalid_authorization_scheme')
  })

  it('truncates user-agent to 100 characters', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.44'
    const longUA = 'A'.repeat(200)

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 10_400,
      rateLimitDir,
      remoteAddr,
      userAgent: longUA,
    })

    expect(response.status).toBe(403)
    expect(response.stderr).toContain(`(UA: ${'A'.repeat(100)})`)
    expect(response.stderr).not.toContain(`(UA: ${'A'.repeat(101)})`)
  })

  it('logs "unknown" when REMOTE_ADDR is missing', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')

    const response = await runAuthRequest({
      authorization: 'Bearer wrong-token',
      now: 10_500,
      rateLimitDir,
      remoteAddr: '',
    })

    expect(response.stderr).toContain('euroalt-admin: auth FAILED from unknown')
  })

  it('does not leak the bearer token in log messages', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.46'
    const secretToken = 'super-secret-token-that-should-not-appear-in-logs'

    const response = await runAuthRequest({
      authorization: `Bearer ${secretToken}`,
      now: 10_600,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(403)
    expect(response.stderr).not.toContain(secretToken)
    expect(response.stderr).toContain('euroalt-admin: auth FAILED')
  })
})

describe('admin auth on real admin endpoints', () => {
  it('rejects unauthenticated add-alternative requests before body validation and logs the attempt', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.50'

    const response = await runAdminEndpointRequest(addAlternativePath, {
      now: 11_000,
      rateLimitDir,
      remoteAddr,
    })

    expect(response.status).toBe(401)
    expect(response.json).toEqual({
      ok: false,
      error: 'missing_authorization',
    })
    expect(response.stderr).toContain(
      'euroalt-admin: auth FAILED from 198.51.100.50 reason=missing_authorization',
    )
  })

  it('applies the shared auth rate limiter to deny-alternative.php', async () => {
    const rateLimitDir = createTempPath('euroalt-admin-rate-limit-')
    const remoteAddr = '198.51.100.51'

    for (let offset = 0; offset < 5; offset += 1) {
      const response = await runAdminEndpointRequest(denyAlternativePath, {
        authorization: 'Bearer wrong-token',
        now: 11_100 + offset,
        rateLimitDir,
        remoteAddr,
      })

      expect(response.status).toBe(403)
      expect(response.json).toEqual({ ok: false, error: 'forbidden' })
    }

    const throttledResponse = await runAdminEndpointRequest(denyAlternativePath, {
      authorization: 'Bearer wrong-token',
      now: 11_105,
      rateLimitDir,
      remoteAddr,
    })

    expect(throttledResponse.status).toBe(429)
    expect(throttledResponse.json).toEqual({
      ok: false,
      error: 'too_many_auth_attempts',
    })
    expect(getHeader(throttledResponse.headers, 'Retry-After')).toBe('895')
    expect(throttledResponse.stderr).toContain(
      'euroalt-admin: auth FAILED from 198.51.100.51 reason=forbidden',
    )
  })
})
