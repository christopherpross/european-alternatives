import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export const pathRules = Object.freeze([
  {
    id: 'ignored-env-file',
    description: 'Environment files must stay out of git.',
    pattern: /(^|\/)\.env(?:\.[^/]+)?$/u,
  },
  {
    id: 'pem-key-material',
    description: 'PEM key material must stay out of git.',
    pattern: /\.pem$/u,
  },
  {
    id: 'private-key-file',
    description: 'Private key files must stay out of git.',
    pattern: /\.key$/u,
  },
  {
    id: 'certificate-keystore',
    description: 'Certificate keystores must stay out of git.',
    pattern: /\.(?:p12|pfx|keystore|jks)$/u,
  },
  {
    id: 'php-local-db-secret-file',
    description: 'The local database secret file must never be tracked.',
    pattern: /^api\/config\/db\.env\.php$/u,
  },
  {
    id: 'php-local-admin-token-file',
    description: 'The local admin token file must never be tracked.',
    pattern: /^api\/config\/admin-token\.php$/u,
  },
  {
    id: 'php-local-config-override',
    description: 'Local PHP config overrides must stay out of git.',
    pattern: /^api\/config\/[^/]+\.local\.php$/u,
  },
  {
    id: 'minimax-api-key-file',
    description: 'The MiniMax API key file must never be tracked.',
    pattern: /^scripts\/\.minimax-api-key$/u,
  },
])

export const contentRules = Object.freeze([
  {
    id: 'euroalt-db-pass-assignment',
    key: 'EUROALT_DB_PASS',
    placeholder: 'replace-with-a-long-random-password',
    description: 'Real EUROALT_DB_PASS values must stay out of git.',
  },
  {
    id: 'euroalt-admin-token-assignment',
    key: 'EUROALT_ADMIN_TOKEN',
    placeholder: 'replace-with-a-long-random-token',
    description: 'Real EUROALT_ADMIN_TOKEN values must stay out of git.',
  },
])

function normalizeSlashes(value) {
  return value.split(sep).join('/')
}

export function normalizeRepoPath(filePath) {
  const absolutePath = resolve(repoRoot, filePath)
  const relativePath = relative(repoRoot, absolutePath)

  if (relativePath === '') {
    return '.'
  }

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    return normalizeSlashes(filePath)
  }

  return normalizeSlashes(relativePath)
}

export function findBlockedPathRule(filePath) {
  const normalizedPath = normalizeRepoPath(filePath)

  return (
    pathRules.find((rule) => rule.pattern.test(normalizedPath)) ?? null
  )
}

function parseGitOutput(command, args) {
  const output = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function listTrackedFiles() {
  return parseGitOutput('git', ['ls-files'])
}

export function listStagedFiles() {
  return parseGitOutput('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
  ])
}

function isBinaryBuffer(buffer) {
  return buffer.includes(0)
}

function readTextFile(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  const buffer = readFileSync(filePath)

  if (isBinaryBuffer(buffer)) {
    return null
  }

  return buffer.toString('utf8')
}

function readStagedTextFile(filePath) {
  try {
    const buffer = execFileSync('git', ['show', `:${filePath}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (isBinaryBuffer(buffer)) {
      return null
    }

    return buffer.toString('utf8')
  } catch {
    return null
  }
}

function extractAssignedValue(line, key) {
  const marker = `${key}=`
  const markerIndex = line.indexOf(marker)

  if (markerIndex === -1) {
    return null
  }

  let value = line.slice(markerIndex + marker.length).trim()

  value = value.replace(/^[`'"]+/u, '')

  const terminator = value.search(/[`'"\s),;]/u)

  if (terminator !== -1) {
    value = value.slice(0, terminator)
  }

  return value.trim()
}

function isAllowedValue(value, placeholder) {
  return (
    value === '' ||
    value === '...' ||
    value === placeholder ||
    value.startsWith('$') ||
    value.startsWith('${')
  )
}

function findContentFindings(filePath, content) {
  const normalizedPath = normalizeRepoPath(filePath)
  const findings = []
  const lines = content.split(/\r?\n/u)

  for (const [index, line] of lines.entries()) {
    for (const rule of contentRules) {
      const value = extractAssignedValue(line, rule.key)

      if (value === null || isAllowedValue(value, rule.placeholder)) {
        continue
      }

      findings.push({
        path: normalizedPath,
        line: index + 1,
        ruleId: rule.id,
        message: rule.description,
      })
    }
  }

  return findings
}

export function scanFiles(filePaths, options = {}) {
  const { source = 'workingTree' } = options
  const findings = []

  for (const filePath of filePaths) {
    const normalizedPath = normalizeRepoPath(filePath)
    const blockedPathRule = findBlockedPathRule(normalizedPath)

    if (blockedPathRule) {
      findings.push({
        path: normalizedPath,
        ruleId: blockedPathRule.id,
        message: blockedPathRule.description,
      })
      continue
    }

    const content =
      source === 'staged'
        ? readStagedTextFile(normalizedPath)
        : readTextFile(resolve(repoRoot, normalizedPath))

    if (content === null) {
      continue
    }

    findings.push(...findContentFindings(normalizedPath, content))
  }

  return findings
}
