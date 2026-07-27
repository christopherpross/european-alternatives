import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

const bootstrapPath = resolve('api/bootstrap.php')
const tempPaths: string[] = []

let phpPromise: Promise<PHP> | undefined

function createTempDir(prefix: string): string {
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

type PhpResult = {
  stdout: string
  stderr: string
  exitCode: number
}

async function runPhp(
  code: string,
  env: Record<string, string> = {},
): Promise<PhpResult> {
  const php = await getPhp()
  const response = await php.runStream({ code, env })

  return {
    stdout: await response.stdoutText,
    stderr: await response.stderrText,
    exitCode: await response.exitCode,
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

describe('bootstrap.php path restriction', () => {
  describe('APP_SECRETS_DIRECTORY constant', () => {
    it('defines APP_SECRETS_DIRECTORY pointing to the Hostinger secrets path', async () => {
      const result = await runPhp(`<?php
        declare(strict_types=1);
        require ${JSON.stringify(bootstrapPath)};
        echo json_encode(['dir' => APP_SECRETS_DIRECTORY], JSON_THROW_ON_ERROR);
      `)

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { dir: string }
      expect(json.dir).toBe('/home/u688914453/.secrets/')
    })

    it('allows overriding APP_SECRETS_DIRECTORY via define() before inclusion', async () => {
      const result = await runPhp(`<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', '/custom/test/secrets/');
        require ${JSON.stringify(bootstrapPath)};
        echo json_encode(['dir' => APP_SECRETS_DIRECTORY], JSON_THROW_ON_ERROR);
      `)

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { dir: string }
      expect(json.dir).toBe('/custom/test/secrets/')
    })
  })

  describe('loadEnvironmentOverrides() path restriction', () => {
    it('silently skips when env loader file does not exist (realpath returns false)', async () => {
      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        require ${JSON.stringify(bootstrapPath)};
        loadEnvironmentOverrides();
        echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        `,
        { EUROALT_ENV_LOADER: '/nonexistent/path/to/env-loader.php' },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean }
      expect(json.ok).toBe(true)
    })

    it('throws RuntimeException when env loader path resolves outside allowed directory', async () => {
      const secretsDir = createTempDir('euroalt-secrets-')
      const evilDir = createTempDir('euroalt-evil-')
      const evilFile = join(evilDir, 'evil.php')
      writeFileSync(evilFile, '<?php // evil code')

      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', ${JSON.stringify(secretsDir + '/')});
        require ${JSON.stringify(bootstrapPath)};

        try {
            loadEnvironmentOverrides();
            echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        } catch (RuntimeException $e) {
            echo json_encode([
                'ok' => false,
                'message' => $e->getMessage(),
            ], JSON_THROW_ON_ERROR);
        }
        `,
        { EUROALT_ENV_LOADER: evilFile },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; message?: string }
      expect(json.ok).toBe(false)
      expect(json.message).toBe('Env loader path is outside the allowed directory.')
    })

    it('loads the env loader file when it resolves inside the allowed directory', async () => {
      const secretsDir = createTempDir('euroalt-secrets-')
      const envFile = join(secretsDir, 'env-loader.php')
      writeFileSync(envFile, "<?php putenv('EUROALT_TEST_MARKER=loaded-successfully');")

      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', ${JSON.stringify(secretsDir + '/')});
        require ${JSON.stringify(bootstrapPath)};

        loadEnvironmentOverrides();
        echo json_encode([
            'ok' => true,
            'marker' => getenv('EUROALT_TEST_MARKER'),
        ], JSON_THROW_ON_ERROR);
        `,
        { EUROALT_ENV_LOADER: envFile },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; marker: string }
      expect(json.ok).toBe(true)
      expect(json.marker).toBe('loaded-successfully')
    })

    it('silently skips when EUROALT_ENV_LOADER is empty', async () => {
      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        require ${JSON.stringify(bootstrapPath)};
        loadEnvironmentOverrides();
        echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        `,
        { EUROALT_ENV_LOADER: '' },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean }
      expect(json.ok).toBe(true)
    })
  })

  describe('loadDbConfig() path restriction', () => {
    it('throws RuntimeException when db config path resolves outside allowed directory', async () => {
      const secretsDir = createTempDir('euroalt-secrets-')
      const evilDir = createTempDir('euroalt-evil-')
      const evilFile = join(evilDir, 'evil-db.php')
      writeFileSync(
        evilFile,
        "<?php return ['host'=>'x','database'=>'x','username'=>'x','password'=>'x'];",
      )

      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', ${JSON.stringify(secretsDir + '/')});
        require ${JSON.stringify(bootstrapPath)};

        try {
            loadDbConfig();
            echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        } catch (RuntimeException $e) {
            echo json_encode([
                'ok' => false,
                'message' => $e->getMessage(),
            ], JSON_THROW_ON_ERROR);
        }
        `,
        { EUROALT_DB_CONFIG: evilFile, EUROALT_ENV_LOADER: '/nonexistent' },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; message?: string }
      expect(json.ok).toBe(false)
      expect(json.message).toBe('Database config path is outside the allowed directory.')
    })

    it('loads db config when path resolves inside the allowed directory', async () => {
      const secretsDir = createTempDir('euroalt-secrets-')
      const configFile = join(secretsDir, 'db.php')
      writeFileSync(
        configFile,
        `<?php return [
          'host' => '127.0.0.1',
          'port' => 3306,
          'database' => 'test_db',
          'username' => 'test_user',
          'password' => 'test_pass',
          'charset' => 'utf8mb4',
        ];`,
      )

      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', ${JSON.stringify(secretsDir + '/')});
        require ${JSON.stringify(bootstrapPath)};

        try {
            $config = loadDbConfig();
            echo json_encode(['ok' => true, 'host' => $config['host']], JSON_THROW_ON_ERROR);
        } catch (RuntimeException $e) {
            echo json_encode([
                'ok' => false,
                'message' => $e->getMessage(),
            ], JSON_THROW_ON_ERROR);
        }
        `,
        { EUROALT_DB_CONFIG: configFile, EUROALT_ENV_LOADER: '/nonexistent' },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; host?: string }
      expect(json.ok).toBe(true)
      expect(json.host).toBe('127.0.0.1')
    })

    it('throws RuntimeException when db config file does not exist', async () => {
      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        require ${JSON.stringify(bootstrapPath)};

        try {
            loadDbConfig();
            echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        } catch (RuntimeException $e) {
            echo json_encode([
                'ok' => false,
                'message' => $e->getMessage(),
            ], JSON_THROW_ON_ERROR);
        }
        `,
        {
          EUROALT_DB_CONFIG: '/nonexistent/db-config.php',
          EUROALT_ENV_LOADER: '/nonexistent',
        },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; message?: string }
      expect(json.ok).toBe(false)
      expect(json.message).toBe('Database config file is missing or unreadable.')
    })

    it('prefers environment variables over file config (bypassing path restriction)', async () => {
      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        require ${JSON.stringify(bootstrapPath)};

        $config = loadDbConfig();
        echo json_encode(['host' => $config['host'], 'database' => $config['database']], JSON_THROW_ON_ERROR);
        `,
        {
          EUROALT_DB_HOST: 'env-host.test',
          EUROALT_DB_NAME: 'env_database',
          EUROALT_DB_USER: 'env_user',
          EUROALT_DB_PASS: 'env_pass',
          EUROALT_ENV_LOADER: '/nonexistent',
        },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { host: string; database: string }
      expect(json.host).toBe('env-host.test')
      expect(json.database).toBe('env_database')
    })
  })

  describe('symlink traversal defense', () => {
    it('rejects symlink that resolves outside the allowed directory', async () => {
      const { symlinkSync } = await import('node:fs')

      const secretsDir = createTempDir('euroalt-secrets-')
      const evilDir = createTempDir('euroalt-evil-')
      const evilFile = join(evilDir, 'evil.php')
      writeFileSync(evilFile, '<?php // malicious payload')

      const symlinkPath = join(secretsDir, 'sneaky-link.php')
      symlinkSync(evilFile, symlinkPath)

      const result = await runPhp(
        `<?php
        declare(strict_types=1);
        define('APP_SECRETS_DIRECTORY', ${JSON.stringify(secretsDir + '/')});
        require ${JSON.stringify(bootstrapPath)};

        try {
            loadEnvironmentOverrides();
            echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        } catch (RuntimeException $e) {
            echo json_encode([
                'ok' => false,
                'message' => $e->getMessage(),
            ], JSON_THROW_ON_ERROR);
        }
        `,
        { EUROALT_ENV_LOADER: symlinkPath },
      )

      expect(result.exitCode).toBe(0)
      const json = JSON.parse(result.stdout) as { ok: boolean; message?: string }
      expect(json.ok).toBe(false)
      expect(json.message).toBe('Env loader path is outside the allowed directory.')
    })
  })

  describe('consistency with auth.php', () => {
    it('auth.php uses the same APP_SECRETS_DIRECTORY constant from bootstrap.php', async () => {
      const authPath = resolve('api/admin/auth.php')
      const { readFileSync } = await import('node:fs')
      const authSource = readFileSync(authPath, 'utf8')

      expect(authSource).toContain('APP_SECRETS_DIRECTORY')
      expect(authSource).not.toMatch(/str_starts_with\(\$realTokenPath,\s*'\/home\/u688914453/)
    })
  })
})
