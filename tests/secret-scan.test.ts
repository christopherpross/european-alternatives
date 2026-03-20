import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = new URL('..', import.meta.url).pathname
const scanScriptPath = new URL('../scripts/scan-secrets.mjs', import.meta.url)
const createdFiles: string[] = []
const stagedFiles: string[] = []
const dbPasswordKey = 'EUROALT_DB_PASS'
const adminTokenKey = 'EUROALT_ADMIN_TOKEN'
const npmExecPath = process.env.npm_execpath

function runSecretScan(...paths: string[]) {
  return spawnSync(process.execPath, [scanScriptPath.pathname, ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

function runStagedSecretScan(...paths: string[]) {
  return spawnSync(
    process.execPath,
    [scanScriptPath.pathname, '--staged', ...paths],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
}

function runTrackedSecretScan() {
  if (!npmExecPath) {
    throw new Error('npm_execpath is required to run npm-backed integration tests.')
  }

  return spawnSync(process.execPath, [npmExecPath, 'run', 'secrets:scan'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

function createTempFile(relativePath: string, content: string): string {
  const absolutePath = new URL(`../${relativePath}`, import.meta.url).pathname

  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
  createdFiles.push(absolutePath)

  return relativePath
}

function runGit(...args: string[]) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
    )
  }
}

function stageTempFile(relativePath: string, content: string): string {
  const stagedPath = createTempFile(relativePath, content)

  runGit('add', '--', stagedPath)
  stagedFiles.push(stagedPath)

  return stagedPath
}

afterEach(() => {
  if (stagedFiles.length > 0) {
    runGit('reset', '--quiet', 'HEAD', '--', ...stagedFiles)
  }

  for (const filePath of createdFiles) {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  stagedFiles.length = 0
  createdFiles.length = 0
})

describe('secret scan CLI', () => {
  it('allows the checked-in placeholder database example', () => {
    const result = runSecretScan('api/config/db.env.example.php')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('allows the checked-in placeholder admin token example', () => {
    const result = runSecretScan('api/config/admin-token.example.php')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('allows the fake token fixture used by admin auth tests', () => {
    const fixture = readFileSync(
      new URL('../tests/admin-auth-rate-limit.test.ts', import.meta.url),
      'utf8',
    )

    const relativePath = createTempFile(
      'tmp/secret-scan-fixtures/admin-auth-rate-limit-copy.test.ts',
      fixture,
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('allows the instructional admin token example in the tracked auth helper', () => {
    const result = runSecretScan('api/admin/auth.php')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('allows ellipsis placeholders in instructional putenv examples', () => {
    const fixture = `<?php\n/**\n * The secrets file must call putenv('${adminTokenKey}=...');\n */\n`
    const relativePath = createTempFile(
      'tmp/secret-scan-fixtures/admin-token-docblock.php',
      fixture,
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('rejects real EUROALT_DB_PASS assignments in otherwise normal files', () => {
    const fixture = `<?php\nputenv('${dbPasswordKey}=super-secret-password');\n`
    const relativePath = createTempFile(
      'tmp/secret-scan-fixtures/runtime-config.php',
      fixture,
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('euroalt-db-pass-assignment')
    expect(result.stderr).toContain(relativePath)
    expect(result.stderr).not.toContain('super-secret-password')
  })

  it('rejects real EUROALT_ADMIN_TOKEN assignments in otherwise normal files', () => {
    const fixture = `<?php\nputenv('${adminTokenKey}=super-secret-admin-token');\n`
    const relativePath = createTempFile(
      'tmp/secret-scan-fixtures/admin-auth.php',
      fixture,
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('euroalt-admin-token-assignment')
    expect(result.stderr).toContain(relativePath)
    expect(result.stderr).not.toContain('super-secret-admin-token')
  })

  it('passes the tracked-file scan for the current repository tree', () => {
    const result = runTrackedSecretScan()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('scans the staged blob when the working tree has been cleaned after staging', () => {
    const relativePath = stageTempFile(
      'tests/secret-scan-fixtures/staged-runtime-config.php',
      `<?php\nputenv('${dbPasswordKey}=super-secret-password');\n`,
    )

    createTempFile(
      relativePath,
      `<?php\nputenv('${dbPasswordKey}=replace-with-a-long-random-password');\n`,
    )

    const result = runStagedSecretScan(relativePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('euroalt-db-pass-assignment')
    expect(result.stderr).toContain(relativePath)
    expect(result.stderr).not.toContain('super-secret-password')
  })

  it('ignores unstaged working tree secrets when the staged blob is still clean', () => {
    const relativePath = stageTempFile(
      'tests/secret-scan-fixtures/staged-placeholder-config.php',
      `<?php\nputenv('${adminTokenKey}=replace-with-a-long-random-token');\n`,
    )

    createTempFile(
      relativePath,
      `<?php\nputenv('${adminTokenKey}=super-secret-admin-token');\n`,
    )

    const result = runStagedSecretScan(relativePath)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Secret scan passed')
  })

  it('rejects force-added ignored secret file paths', () => {
    const relativePath = createTempFile(
      'api/config/temporary.local.php',
      "<?php\nreturn ['token' => 'placeholder'];\n",
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('php-local-config-override')
    expect(result.stderr).toContain(relativePath)
  })

  it('rejects force-added env files', () => {
    const fixture = `${dbPasswordKey}=super-secret-password\n`
    const relativePath = createTempFile(
      '.env.production',
      fixture,
    )
    const result = runSecretScan(relativePath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ignored-env-file')
    expect(result.stderr).toContain(relativePath)
    expect(result.stderr).not.toContain('super-secret-password')
  })
})
