import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

const rootHtaccessPath = resolve('.htaccess')
const adminAuthPath = resolve('api/admin/auth.php')
const dbHealthPath = resolve('api/health/db.php')
const dbHealthSource = readFileSync(dbHealthPath, 'utf8')
const validToken = 'b'.repeat(64)
const tempPaths: string[] = []

let phpPromise: Promise<PHP> | undefined

type HealthResponse = {
  status: number
  json: unknown
  stderr: string
}

type HealthRequestOptions = {
  authorization?: string
  rateLimitDir: string
}

function stripDbHealthEndpointSource(source: string): string {
  return source
    .replace(/^<\?php\s*/, '')
    .replace("declare(strict_types=1);\n\n", '')
    .replace("require_once __DIR__ . '/../db.php';\n", '')
    .replace("require_once __DIR__ . '/../admin/auth.php';\n", '')
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

async function runHealthRequest(
  code: string,
  options: HealthRequestOptions,
): Promise<HealthResponse> {
  const php = await getPhp()
  const response = await php.runStream({
    code,
    method: 'GET',
    env: {
      EUROALT_ADMIN_RATE_LIMIT_DIR: options.rateLimitDir,
      EUROALT_ADMIN_TOKEN: validToken,
    },
    $_SERVER: {
      REMOTE_ADDR: '198.51.100.90',
      REQUEST_METHOD: 'GET',
      ...(options.authorization === undefined
        ? {}
        : { HTTP_AUTHORIZATION: options.authorization }),
    },
  })

  return {
    status: await response.httpStatusCode,
    json: JSON.parse(await response.stdoutText) as unknown,
    stderr: await response.stderrText,
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

describe('database health endpoint auth', () => {
  it('forwards Authorization headers from the repo root so protected non-admin APIs can authenticate', () => {
    expect(readFileSync(rootHtaccessPath, 'utf8')).toContain(
      'SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1',
    )
  })

  it('rejects unauthenticated requests before exposing database status', async () => {
    const rateLimitDir = createTempPath('euroalt-db-health-auth-')
    const response = await runHealthRequest(
      `<?php
declare(strict_types=1);
require ${JSON.stringify(adminAuthPath)};

function getDatabaseConnection(): never
{
    throw new RuntimeException('DB should not be reached for unauthenticated requests.');
}

function getDatabaseTransportSecurityStatus(object $pdo): array
{
    throw new RuntimeException('Transport probe should not run for unauthenticated requests.');
}

${stripDbHealthEndpointSource(dbHealthSource)}
`,
      { rateLimitDir },
    )

    expect(response.status).toBe(401)
    expect(response.json).toEqual({
      ok: false,
      error: 'missing_authorization',
    })
    expect(response.stderr).toContain(
      'euroalt-admin: auth FAILED from 198.51.100.90 reason=missing_authorization',
    )
  })

  it('returns database status only after a valid bearer token is provided', async () => {
    const rateLimitDir = createTempPath('euroalt-db-health-auth-')
    const response = await runHealthRequest(
      `<?php
declare(strict_types=1);
require ${JSON.stringify(adminAuthPath)};

final class TestDbHealthStatement
{
    public function fetch(): array
    {
        return ['db_ok' => 1];
    }
}

final class TestDbHealthPdo
{
    public function query(string $sql): TestDbHealthStatement
    {
        if ($sql !== 'SELECT 1 AS db_ok') {
            throw new RuntimeException('Unexpected SQL: ' . $sql);
        }

        return new TestDbHealthStatement();
    }
}

function getDatabaseConnection(): TestDbHealthPdo
{
    return new TestDbHealthPdo();
}

function getDatabaseTransportSecurityStatus(object $pdo): array
{
    return [
        'tls_enabled' => true,
        'ssl_cipher' => 'TLS_AES_256_GCM_SHA384',
    ];
}

${stripDbHealthEndpointSource(dbHealthSource)}
`,
      {
        authorization: `Bearer ${validToken}`,
        rateLimitDir,
      },
    )

    expect(response.status).toBe(200)
    expect(response.json).toEqual({
      ok: true,
      db: 'up',
      check: 1,
      transport: {
        probe: 'ok',
        tls: true,
        sslCipher: 'TLS_AES_256_GCM_SHA384',
      },
    })
    expect(response.stderr).toContain('euroalt-admin: auth OK from 198.51.100.90')
  })
})
