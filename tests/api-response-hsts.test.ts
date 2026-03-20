import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

import { permissionsPolicyValue } from './support/permissions-policy'

const bootstrapPath = resolve('api/bootstrap.php')
const cachePath = resolve('api/cache.php')
const notFoundPath = resolve('api/not-found.php')
const expectedHstsValue = 'max-age=31536000; includeSubDomains; preload'
const expectedCspValue =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
const expectedReferrerPolicyValue = 'strict-origin-when-cross-origin'
const expectedPermissionsPolicyValue = permissionsPolicyValue
const expectedXfoValue = 'DENY'
const tempPaths: string[] = []

let phpPromise: Promise<PHP> | undefined

type PhpResponse = {
  status: number
  headers: Record<string, string[]>
  stdoutText: string
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

function getHeader(
  headers: Record<string, string[]>,
  name: string,
): string | undefined {
  const expectedName = name.toLowerCase()

  for (const [headerName, values] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expectedName) {
      return values[0]
    }
  }

  return undefined
}

async function runPhpResponse(options: {
  code: string
  env?: Record<string, string>
  server?: Record<string, string>
}): Promise<PhpResponse> {
  const php = await getPhp()
  const response = await php.runStream({
    code: options.code,
    env: options.env,
    $_SERVER: options.server,
  })

  const stderrText = await response.stderrText
  const exitCode = await response.exitCode

  if (exitCode !== 0) {
    throw new Error(`PHP exited with code ${exitCode}: ${stderrText}`)
  }

  return {
    status: await response.httpStatusCode,
    headers: await response.headers,
    stdoutText: await response.stdoutText,
  }
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

describe('API response security header fallback', () => {
  it('adds repo-owned security headers to JSON success responses from bootstrap helpers', async () => {
    const response = await runPhpResponse({
      code: `<?php
declare(strict_types=1);
require ${JSON.stringify(bootstrapPath)};
sendJsonResponse(201, ['ok' => true]);
`,
    })

    expect(response.status).toBe(201)
    expect(JSON.parse(response.stdoutText)).toEqual({ ok: true })
    expect(getHeader(response.headers, 'Strict-Transport-Security')).toBe(
      expectedHstsValue,
    )
    expect(getHeader(response.headers, 'Content-Security-Policy')).toBe(
      expectedCspValue,
    )
    expect(getHeader(response.headers, 'Referrer-Policy')).toBe(
      expectedReferrerPolicyValue,
    )
    expect(getHeader(response.headers, 'Permissions-Policy')).toBe(
      expectedPermissionsPolicyValue,
    )
    expect(getHeader(response.headers, 'X-Content-Type-Options')).toBe(
      'nosniff',
    )
    expect(getHeader(response.headers, 'X-Frame-Options')).toBe(
      expectedXfoValue,
    )
  })

  it('adds repo-owned security headers to JSON error responses from bootstrap helpers', async () => {
    const response = await runPhpResponse({
      code: `<?php
declare(strict_types=1);
require ${JSON.stringify(bootstrapPath)};
jsonError(403, 'forbidden');
`,
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.stdoutText)).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(getHeader(response.headers, 'Strict-Transport-Security')).toBe(
      expectedHstsValue,
    )
    expect(getHeader(response.headers, 'Content-Security-Policy')).toBe(
      expectedCspValue,
    )
    expect(getHeader(response.headers, 'Referrer-Policy')).toBe(
      expectedReferrerPolicyValue,
    )
    expect(getHeader(response.headers, 'Permissions-Policy')).toBe(
      expectedPermissionsPolicyValue,
    )
    expect(getHeader(response.headers, 'X-Frame-Options')).toBe(
      expectedXfoValue,
    )
  })

  it('adds repo-owned security headers to cache-miss responses', async () => {
    const cacheDir = `${createTempPath('euroalt-hsts-cache-miss-')}/`
    const response = await runPhpResponse({
      code: `<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(cacheDir)});
define('EUROALT_CACHE_TTL', 300);
require ${JSON.stringify(cachePath)};
sendCacheableJsonResponse('entries', ['locale' => 'en'], ['data' => []]);
`,
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({ data: [] })
    expect(getHeader(response.headers, 'Strict-Transport-Security')).toBe(
      expectedHstsValue,
    )
    expect(getHeader(response.headers, 'Content-Security-Policy')).toBe(
      expectedCspValue,
    )
    expect(getHeader(response.headers, 'Referrer-Policy')).toBe(
      expectedReferrerPolicyValue,
    )
    expect(getHeader(response.headers, 'Permissions-Policy')).toBe(
      expectedPermissionsPolicyValue,
    )
    expect(getHeader(response.headers, 'X-Cache')).toBe('MISS')
    expect(getHeader(response.headers, 'X-Frame-Options')).toBe(
      expectedXfoValue,
    )
  })

  it('adds repo-owned security headers to API 404 not-found responses', async () => {
    const response = await runPhpResponse({
      code: `<?php
require ${JSON.stringify(notFoundPath)};
`,
    })

    expect(response.status).toBe(404)
    expect(JSON.parse(response.stdoutText)).toEqual({
      ok: false,
      error: 'not_found',
      detail: 'The requested API endpoint does not exist.',
    })
    expect(getHeader(response.headers, 'Strict-Transport-Security')).toBe(
      expectedHstsValue,
    )
    expect(getHeader(response.headers, 'Content-Security-Policy')).toBe(
      expectedCspValue,
    )
    expect(getHeader(response.headers, 'Referrer-Policy')).toBe(
      expectedReferrerPolicyValue,
    )
    expect(getHeader(response.headers, 'Permissions-Policy')).toBe(
      expectedPermissionsPolicyValue,
    )
    expect(getHeader(response.headers, 'X-Frame-Options')).toBe(
      expectedXfoValue,
    )
  })

  it('adds repo-owned security headers to cache-hit responses', async () => {
    const cacheDir = `${createTempPath('euroalt-hsts-cache-hit-')}/`
    const response = await runPhpResponse({
      code: `<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(cacheDir)});
define('EUROALT_CACHE_TTL', 300);
require ${JSON.stringify(cachePath)};

$payload = ['data' => ['cached' => true]];
$cacheFile = buildCachePath('entries', ['locale' => 'en']);
if (!is_dir(dirname($cacheFile))) {
    mkdir(dirname($cacheFile), 0755, true);
}
file_put_contents($cacheFile, json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

serveCachedResponse('entries', ['locale' => 'en']);
`,
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({
      data: { cached: true },
    })
    expect(getHeader(response.headers, 'Strict-Transport-Security')).toBe(
      expectedHstsValue,
    )
    expect(getHeader(response.headers, 'Content-Security-Policy')).toBe(
      expectedCspValue,
    )
    expect(getHeader(response.headers, 'Referrer-Policy')).toBe(
      expectedReferrerPolicyValue,
    )
    expect(getHeader(response.headers, 'Permissions-Policy')).toBe(
      expectedPermissionsPolicyValue,
    )
    expect(getHeader(response.headers, 'X-Cache')).toBe('HIT')
    expect(getHeader(response.headers, 'X-Frame-Options')).toBe(
      expectedXfoValue,
    )
  })
})
