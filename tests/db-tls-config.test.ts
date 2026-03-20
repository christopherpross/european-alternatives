import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node'
import { PHP } from '@php-wasm/universal'
import { afterAll, describe, expect, it } from 'vitest'

const bootstrapPath = resolve('api/bootstrap.php')
const dbPath = resolve('api/db.php')
const apiReadmePath = resolve('api/README.md')
const envExamplePath = resolve('api/config/db.env.example.php')
const fileExamplePath = resolve('api/config/db.example.php')
const workspaceTmpRoot = resolve('tmp')
const dbSource = readFileSync(dbPath, 'utf8')
const apiReadme = readFileSync(apiReadmePath, 'utf8')
const envExample = readFileSync(envExamplePath, 'utf8')
const fileExample = readFileSync(fileExamplePath, 'utf8')
const missingEnvLoaderPath = join(workspaceTmpRoot, 'euroalt-missing-env-loader.php')
const tempPaths: string[] = []

let phpPromise: Promise<PHP> | undefined

function createTempPath(prefix: string): string {
  const path = mkdtempSync(join(workspaceTmpRoot, prefix))
  chmodSync(path, 0o755)
  tempPaths.push(path)
  return path
}

function createTempFile(prefix: string, fileName: string, contents = 'test'): string {
  const directory = createTempPath(prefix)
  const filePath = join(directory, fileName)
  writeFileSync(filePath, contents)
  return filePath
}

function createPhpConfigFile(config: string): string {
  const directory = createTempPath('euroalt-db-config-')
  const configPath = join(directory, 'db.php')
  writeFileSync(configPath, config)
  return configPath
}

function getPhp(): Promise<PHP> {
  phpPromise ??= loadNodeRuntime('8.3').then((runtime) => {
    const php = new PHP(runtime)
    useHostFilesystem(php)
    return php
  })
  return phpPromise
}

async function runPhpJson(
  code: string,
  env: Record<string, string> = {},
): Promise<unknown> {
  const php = await getPhp()
  const response = await php.runStream({
    code,
    env: {
      EUROALT_ENV_LOADER: missingEnvLoaderPath,
      ...env,
    },
  })
  const stdoutText = await response.stdoutText
  const stderrText = await response.stderrText
  const exitCode = await response.exitCode

  if (exitCode !== 0) {
    throw new Error(`PHP exited with code ${exitCode}: ${stderrText}`)
  }

  return JSON.parse(stdoutText) as unknown
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

describe('database TLS config', () => {
  it('loads optional TLS settings from environment variables', async () => {
    const caPath = createTempFile('euroalt-db-ca-', 'mysql-ca.pem')
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};
      echo json_encode(loadDbConfigFromEnvironment(), JSON_THROW_ON_ERROR);
      `,
      {
        EUROALT_DB_HOST: 'db.example.test',
        EUROALT_DB_PORT: '3307',
        EUROALT_DB_NAME: 'euroalt',
        EUROALT_DB_USER: 'db-user',
        EUROALT_DB_PASS: 'db-pass',
        EUROALT_DB_CHARSET: 'utf8mb4',
        EUROALT_DB_SSL_CA: caPath,
        EUROALT_DB_SSL_CIPHER: 'ECDHE-RSA-AES128-GCM-SHA256',
        EUROALT_DB_SSL_VERIFY_SERVER_CERT: 'true',
        EUROALT_DB_REQUIRE_TLS: '1',
      },
    )

    expect(result).toEqual({
      driver: 'mysql',
      host: 'db.example.test',
      port: 3307,
      database: 'euroalt',
      username: 'db-user',
      password: 'db-pass',
      charset: 'utf8mb4',
      ssl_ca: caPath,
      ssl_capath: null,
      ssl_cert: null,
      ssl_key: null,
      ssl_cipher: 'ECDHE-RSA-AES128-GCM-SHA256',
      ssl_verify_server_cert: true,
      require_tls: true,
    })
  })

  it('treats ssl_verify_server_cert=0 as disabled instead of active TLS config', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};
      echo json_encode(loadDbConfigFromEnvironment(), JSON_THROW_ON_ERROR);
      `,
      {
        EUROALT_DB_HOST: '127.0.0.1',
        EUROALT_DB_PORT: '3306',
        EUROALT_DB_NAME: 'u688914453_euroalt',
        EUROALT_DB_USER: 'u688914453_app',
        EUROALT_DB_PASS: 'replace-with-a-long-random-password',
        EUROALT_DB_CHARSET: 'utf8mb4',
        EUROALT_DB_SSL_VERIFY_SERVER_CERT: '0',
        EUROALT_DB_REQUIRE_TLS: '0',
      },
    )

    expect(result).toEqual({
      driver: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'u688914453_euroalt',
      username: 'u688914453_app',
      password: 'replace-with-a-long-random-password',
      charset: 'utf8mb4',
      ssl_ca: null,
      ssl_capath: null,
      ssl_cert: null,
      ssl_key: null,
      ssl_cipher: null,
      ssl_verify_server_cert: null,
      require_tls: false,
    })
  })

  it('fails fast when a configured TLS path is unreadable', async () => {
    const configPath = createPhpConfigFile(`<?php
declare(strict_types=1);

return [
    'host' => 'db.example.test',
    'port' => 3306,
    'database' => 'euroalt',
    'username' => 'db-user',
    'password' => 'db-pass',
    'charset' => 'utf8mb4',
    'ssl_ca' => '/definitely/missing/mysql-ca.pem',
];
`)

    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      try {
          loadDbConfig();
          echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
      } catch (Throwable $exception) {
          echo json_encode([
              'ok' => false,
              'message' => $exception->getMessage(),
          ], JSON_THROW_ON_ERROR);
      }
      `,
      {
        EUROALT_DB_CONFIG: configPath,
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Database config key "ssl_ca" must point to a readable path.',
    })
  })

  it('rejects invalid boolean TLS environment variables', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      try {
          loadDbConfigFromEnvironment();
          echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
      } catch (Throwable $exception) {
          echo json_encode([
              'ok' => false,
              'message' => $exception->getMessage(),
          ], JSON_THROW_ON_ERROR);
      }
      `,
      {
        EUROALT_DB_HOST: 'db.example.test',
        EUROALT_DB_NAME: 'euroalt',
        EUROALT_DB_USER: 'db-user',
        EUROALT_DB_PASS: 'db-pass',
        EUROALT_DB_REQUIRE_TLS: 'definitely',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Database config key "require_tls" must be a boolean.',
    })
  })

  it('rejects remote database hosts that do not require verified TLS', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      try {
          loadDbConfigFromEnvironment();
          echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
      } catch (Throwable $exception) {
          echo json_encode([
              'ok' => false,
              'message' => $exception->getMessage(),
          ], JSON_THROW_ON_ERROR);
      }
      `,
      {
        EUROALT_DB_HOST: 'db.example.test',
        EUROALT_DB_NAME: 'euroalt',
        EUROALT_DB_USER: 'db-user',
        EUROALT_DB_PASS: 'db-pass',
        EUROALT_DB_REQUIRE_TLS: '0',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Remote database hosts must set "require_tls" to true.',
    })
  })

  it('rejects remote database hosts without a CA path', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      try {
          loadDbConfigFromEnvironment();
          echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
      } catch (Throwable $exception) {
          echo json_encode([
              'ok' => false,
              'message' => $exception->getMessage(),
          ], JSON_THROW_ON_ERROR);
      }
      `,
      {
        EUROALT_DB_HOST: 'db.example.test',
        EUROALT_DB_NAME: 'euroalt',
        EUROALT_DB_USER: 'db-user',
        EUROALT_DB_PASS: 'db-pass',
        EUROALT_DB_SSL_VERIFY_SERVER_CERT: '1',
        EUROALT_DB_REQUIRE_TLS: '1',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Remote database hosts must configure "ssl_ca" or "ssl_capath" so the server certificate can be verified.',
    })
  })

  it('rejects remote database hosts without certificate verification', async () => {
    const caPath = createTempFile('euroalt-db-ca-', 'mysql-ca.pem')
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      try {
          loadDbConfigFromEnvironment();
          echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
      } catch (Throwable $exception) {
          echo json_encode([
              'ok' => false,
              'message' => $exception->getMessage(),
          ], JSON_THROW_ON_ERROR);
      }
      `,
      {
        EUROALT_DB_HOST: 'db.example.test',
        EUROALT_DB_NAME: 'euroalt',
        EUROALT_DB_USER: 'db-user',
        EUROALT_DB_PASS: 'db-pass',
        EUROALT_DB_SSL_CA: caPath,
        EUROALT_DB_REQUIRE_TLS: '1',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Remote database hosts must enable "ssl_verify_server_cert".',
    })
  })

  it('normalizes file and environment example defaults to the same TLS-disabled config', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(bootstrapPath)};

      echo json_encode([
          'env' => loadDbConfigFromEnvironment(),
          'file' => normalizeDbConfig(require ${JSON.stringify(fileExamplePath)}),
      ], JSON_THROW_ON_ERROR);
      `,
      {
        EUROALT_DB_HOST: '127.0.0.1',
        EUROALT_DB_PORT: '3306',
        EUROALT_DB_NAME: 'u688914453_euroalt',
        EUROALT_DB_USER: 'u688914453_euroalt',
        EUROALT_DB_PASS: 'replace-with-a-long-random-password',
        EUROALT_DB_CHARSET: 'utf8mb4',
        EUROALT_DB_SSL_VERIFY_SERVER_CERT: '0',
        EUROALT_DB_REQUIRE_TLS: '0',
      },
    )

    expect(result).toEqual({
      env: {
        driver: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        database: 'u688914453_euroalt',
        username: 'u688914453_euroalt',
        password: 'replace-with-a-long-random-password',
        charset: 'utf8mb4',
        ssl_ca: null,
        ssl_capath: null,
        ssl_cert: null,
        ssl_key: null,
        ssl_cipher: null,
        ssl_verify_server_cert: null,
        require_tls: false,
      },
      file: {
        driver: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        database: 'u688914453_euroalt',
        username: 'u688914453_euroalt',
        password: 'replace-with-a-long-random-password',
        charset: 'utf8mb4',
        ssl_ca: null,
        ssl_capath: null,
        ssl_cert: null,
        ssl_key: null,
        ssl_cipher: null,
        ssl_verify_server_cert: null,
        require_tls: false,
      },
    })
  })

  it('only asserts transport security for active TLS options', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(dbPath)};
      echo json_encode([
          'plain' => shouldAssertDatabaseTransportSecurity([
              'host' => '127.0.0.1',
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => false,
              'require_tls' => false,
          ]),
          'required' => shouldAssertDatabaseTransportSecurity([
              'host' => 'db.example.test',
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => null,
              'require_tls' => true,
          ]),
          'verifyOnlyDisabled' => shouldAssertDatabaseTransportSecurity([
              'host' => 'db.example.test',
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => false,
              'require_tls' => false,
          ]),
          'verifyOnlyEnabled' => shouldAssertDatabaseTransportSecurity([
              'host' => 'db.example.test',
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => true,
              'require_tls' => false,
          ]),
          'tlsOptionOnly' => shouldAssertDatabaseTransportSecurity([
              'host' => 'db.example.test',
              'ssl_ca' => '/tmp/mysql-ca.pem',
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => null,
              'require_tls' => false,
          ]),
      ], JSON_THROW_ON_ERROR);
      `,
    )

    expect(result).toEqual({
      plain: false,
      required: true,
      verifyOnlyDisabled: false,
      verifyOnlyEnabled: true,
      tlsOptionOnly: true,
    })
  })

  it('only preflights transport security for remote hosts with active TLS settings', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(dbPath)};
      echo json_encode([
          'loopback' => shouldPreflightDatabaseTransportSecurity([
              'host' => '127.0.0.1',
              'ssl_ca' => '/tmp/mysql-ca.pem',
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => true,
              'require_tls' => true,
          ]),
          'remote' => shouldPreflightDatabaseTransportSecurity([
              'host' => 'db.example.test',
              'ssl_ca' => '/tmp/mysql-ca.pem',
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => true,
              'require_tls' => true,
          ]),
      ], JSON_THROW_ON_ERROR);
      `,
    )

    expect(result).toEqual({
      loopback: false,
      remote: true,
    })
  })

  it('parses MySQL handshake capability flags for TLS support', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(dbPath)};

      $withTls = hex2bin('0a382e302e3336000100000041424344454647480000082102000000');
      $withoutTls = hex2bin('0a382e302e3336000100000041424344454647480000002102000000');

      echo json_encode([
          'withTls' => (parseMysqlServerCapabilityFlags($withTls) & MYSQL_CLIENT_SSL_CAPABILITY) === MYSQL_CLIENT_SSL_CAPABILITY,
          'withoutTls' => (parseMysqlServerCapabilityFlags($withoutTls) & MYSQL_CLIENT_SSL_CAPABILITY) === MYSQL_CLIENT_SSL_CAPABILITY,
      ], JSON_THROW_ON_ERROR);
      `,
    )

    expect(result).toEqual({
      withTls: true,
      withoutTls: false,
    })
  })

  it('keeps example defaults out of PDO TLS options', async () => {
    const result = await runPhpJson(
      `<?php
      declare(strict_types=1);
      require ${JSON.stringify(dbPath)};
      echo json_encode([
          'count' => count(buildDatabaseConnectionOptions([
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => false,
              'require_tls' => false,
          ])),
          'verifyOnlyCount' => count(buildDatabaseConnectionOptions([
              'ssl_ca' => null,
              'ssl_capath' => null,
              'ssl_cert' => null,
              'ssl_key' => null,
              'ssl_cipher' => null,
              'ssl_verify_server_cert' => null,
              'require_tls' => false,
          ])),
      ], JSON_THROW_ON_ERROR);
      `,
    )

    expect(result).toEqual({
      count: 3,
      verifyOnlyCount: 3,
    })
  })
})

describe('database TLS documentation', () => {
  it('documents the new remote-MySQL TLS settings in tracked examples and runtime code', () => {
    expect(envExample).toContain('EUROALT_DB_SSL_CA')
    expect(envExample).toContain('EUROALT_DB_SSL_VERIFY_SERVER_CERT')
    expect(envExample).toContain('EUROALT_DB_REQUIRE_TLS')

    expect(fileExample).toContain("'ssl_ca' => null")
    expect(fileExample).toContain("'ssl_verify_server_cert' => false")
    expect(fileExample).toContain("'require_tls' => false")

    expect(apiReadme).toContain('Remote database hosts must set')
    expect(apiReadme).toContain('EUROALT_DB_REQUIRE_TLS=1')
    expect(apiReadme).toContain('EUROALT_DB_SSL_VERIFY_SERVER_CERT=1')

    expect(dbSource).toContain('assertDatabaseServerAdvertisesTlsSupport')
    expect(dbSource).toContain('MYSQL_CLIENT_SSL_CAPABILITY')
    expect(dbSource).toContain("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
    expect(dbSource).toContain('PDO::MYSQL_ATTR_SSL_CA')
    expect(dbSource).toContain('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')
  })
})
