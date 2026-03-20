import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

const cachePath = resolve('api/cache.php')
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

async function runPhpResponse(code: string): Promise<PhpResponse> {
  const php = await getPhp()
  const response = await php.runStream({ code })

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

describe('API cache hardening', () => {
  it('uses a private Hostinger-owned default cache directory instead of /tmp', async () => {
    const response = await runPhpResponse(`<?php
declare(strict_types=1);
require ${JSON.stringify(cachePath)};
echo json_encode(['dir' => EUROALT_CACHE_DIR], JSON_THROW_ON_ERROR);
`)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({
      dir: '/home/u688914453/.local/state/euroalt-api-cache',
    })
    expect(readFileSync(cachePath, 'utf8')).not.toContain('/tmp/euroalt-cache')
  })

  it('treats a symlinked cache directory as an unsafe cache miss', async () => {
    const cacheTargetDir = createTempPath('euroalt-cache-target-')
    const symlinkParentDir = createTempPath('euroalt-cache-link-parent-')
    const symlinkCacheDir = join(symlinkParentDir, 'cache-link')
    symlinkSync(cacheTargetDir, symlinkCacheDir)
    writeFileSync(
      join(cacheTargetDir, 'tags.json'),
      JSON.stringify({ data: ['poisoned'] }),
    )

    const response = await runPhpResponse(`<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(`${symlinkCacheDir}/`)});
require ${JSON.stringify(cachePath)};
echo json_encode(['served' => serveCachedResponse('tags')], JSON_THROW_ON_ERROR);
`)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({ served: false })
    expect(getHeader(response.headers, 'X-Cache')).toBeUndefined()
  })

  it('treats a symlinked cache file as an unsafe cache miss', async () => {
    const cacheDir = createTempPath('euroalt-cache-safe-dir-')
    const poisonedDir = createTempPath('euroalt-cache-poisoned-file-')
    const poisonedFile = join(poisonedDir, 'poisoned.json')
    const cacheFile = join(cacheDir, 'tags.json')

    writeFileSync(poisonedFile, JSON.stringify({ data: ['poisoned'] }))
    symlinkSync(poisonedFile, cacheFile)

    const response = await runPhpResponse(`<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(`${cacheDir}/`)});
require ${JSON.stringify(cachePath)};
echo json_encode(['served' => serveCachedResponse('tags')], JSON_THROW_ON_ERROR);
`)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({ served: false })
    expect(getHeader(response.headers, 'X-Cache')).toBeUndefined()
  })

  it('rejects malformed cache payloads instead of serving them', async () => {
    const cacheDir = createTempPath('euroalt-cache-invalid-json-')
    const cacheFile = join(cacheDir, 'tags.json')
    writeFileSync(cacheFile, '{"data":')

    const response = await runPhpResponse(`<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(`${cacheDir}/`)});
require ${JSON.stringify(cachePath)};
echo json_encode(['served' => serveCachedResponse('tags')], JSON_THROW_ON_ERROR);
`)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({ served: false })
    expect(getHeader(response.headers, 'X-Cache')).toBeUndefined()
    expect(existsSync(cacheFile)).toBe(false)
  })

  it('skips cache writes when the configured cache directory is a symlink', async () => {
    const cacheTargetDir = createTempPath('euroalt-cache-write-target-')
    const symlinkParentDir = createTempPath('euroalt-cache-write-parent-')
    const symlinkCacheDir = join(symlinkParentDir, 'cache-link')
    symlinkSync(cacheTargetDir, symlinkCacheDir)

    const response = await runPhpResponse(`<?php
declare(strict_types=1);
define('EUROALT_CACHE_DIR', ${JSON.stringify(`${symlinkCacheDir}/`)});
define('EUROALT_CACHE_TTL', 300);
require ${JSON.stringify(cachePath)};
sendCacheableJsonResponse('tags', [], ['data' => ['fresh' => true]]);
`)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.stdoutText)).toEqual({
      data: { fresh: true },
    })
    expect(getHeader(response.headers, 'X-Cache')).toBe('MISS')
    expect(readdirSync(cacheTargetDir)).toEqual([])
  })
})
