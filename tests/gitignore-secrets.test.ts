import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { describe, expect, it, afterEach } from 'vitest'

const gitignorePath = new URL('../.gitignore', import.meta.url)

function readGitignore(): string {
  return readFileSync(gitignorePath, 'utf8')
}

function gitCheckIgnore(filePath: string): boolean {
  try {
    execSync(`git check-ignore -q ${filePath}`, {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: 'pipe',
    })

    return true
  } catch {
    return false
  }
}

const tempFiles: string[] = []

function touchTempFile(name: string): string {
  const fullPath = new URL(`../${name}`, import.meta.url).pathname

  writeFileSync(fullPath, '')
  tempFiles.push(fullPath)

  return name
}

afterEach(() => {
  for (const filePath of tempFiles) {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  tempFiles.length = 0
})

describe('.gitignore secret file patterns', () => {
  describe('contains required patterns', () => {
    const gitignore = readGitignore()

    it('ignores .env files', () => {
      expect(gitignore).toContain('\n.env\n')
      expect(gitignore).toContain('\n.env.*\n')
    })

    it('ignores private key material', () => {
      expect(gitignore).toContain('\n*.pem\n')
      expect(gitignore).toContain('\n*.key\n')
    })

    it('ignores certificate keystores', () => {
      expect(gitignore).toContain('\n*.p12\n')
      expect(gitignore).toContain('\n*.pfx\n')
      expect(gitignore).toContain('\n*.keystore\n')
      expect(gitignore).toContain('\n*.jks\n')
    })

    it('still ignores explicit PHP API secrets', () => {
      expect(gitignore).toContain('api/config/db.env.php')
      expect(gitignore).toContain('api/config/admin-token.php')
      expect(gitignore).toContain('api/config/*.local.php')
    })

    it('still ignores MiniMax API key', () => {
      expect(gitignore).toContain('scripts/.minimax-api-key')
    })
  })

  describe('git check-ignore verifies patterns work', () => {
    it('ignores .env in the project root', () => {
      touchTempFile('.env')
      expect(gitCheckIgnore('.env')).toBe(true)
    })

    it('ignores .env.production', () => {
      touchTempFile('.env.production')
      expect(gitCheckIgnore('.env.production')).toBe(true)
    })

    it('ignores .env.development', () => {
      touchTempFile('.env.development')
      expect(gitCheckIgnore('.env.development')).toBe(true)
    })

    it('ignores .env.local (covered by both *.local and .env.*)', () => {
      touchTempFile('.env.local')
      expect(gitCheckIgnore('.env.local')).toBe(true)
    })

    it('ignores PEM files', () => {
      touchTempFile('server.pem')
      expect(gitCheckIgnore('server.pem')).toBe(true)
    })

    it('ignores KEY files', () => {
      touchTempFile('private.key')
      expect(gitCheckIgnore('private.key')).toBe(true)
    })

    it('ignores P12 files', () => {
      touchTempFile('cert.p12')
      expect(gitCheckIgnore('cert.p12')).toBe(true)
    })

    it('ignores PFX files', () => {
      touchTempFile('cert.pfx')
      expect(gitCheckIgnore('cert.pfx')).toBe(true)
    })

    it('ignores keystore files', () => {
      touchTempFile('debug.keystore')
      expect(gitCheckIgnore('debug.keystore')).toBe(true)
    })

    it('ignores JKS files', () => {
      touchTempFile('truststore.jks')
      expect(gitCheckIgnore('truststore.jks')).toBe(true)
    })
  })

  describe('no tracked files are affected by the new patterns', () => {
    it('has no tracked files matching secret patterns', () => {
      const output = execSync(
        "git ls-files | grep -E '\\.(env|pem|key|p12|pfx|keystore|jks)$' || true",
        {
          cwd: new URL('..', import.meta.url).pathname,
          encoding: 'utf8',
        },
      )

      expect(output.trim()).toBe('')
    })
  })
})
