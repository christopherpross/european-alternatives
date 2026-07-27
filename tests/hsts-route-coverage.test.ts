import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve('.')
const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const expectedHstsDirective =
  'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"'
const firstApiRewriteCondition = 'RewriteCond %{REQUEST_URI} ^/api/ [NC]'

type RouteKind =
  | 'spa-fallback'
  | 'dist-file'
  | 'api-direct-static-file'
  | 'api-direct-php-file'
  | 'api-extensionless-php'
  | 'api-passthrough'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

function classifyRoute(path: string): RouteKind {
  const pathname = new URL(path, 'https://european-alternatives.cloud').pathname
  const relativePath = pathname.replace(/^\/+/u, '')
  const absolutePath = resolve(repoRoot, relativePath)

  if (/^\/api\//iu.test(pathname)) {
    if (isFile(absolutePath)) {
      return pathname.endsWith('.php')
        ? 'api-direct-php-file'
        : 'api-direct-static-file'
    }

    if (isFile(`${absolutePath}.php`)) {
      return 'api-extensionless-php'
    }

    return 'api-passthrough'
  }

  const distPath = resolve(repoRoot, 'dist', relativePath)
  if (relativePath.length > 0 && isFile(distPath)) {
    return 'dist-file'
  }

  return 'spa-fallback'
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('HSTS route coverage', () => {
  it('keeps the edge HSTS directive unconditional so every API branch remains covered', () => {
    const hstsLines = activeLines.filter((line) =>
      line.startsWith('Header always set Strict-Transport-Security '),
    )
    const headerIndex = activeLines.indexOf(expectedHstsDirective)
    const firstApiRuleIndex = activeLines.indexOf(firstApiRewriteCondition)

    expect(hstsLines).toEqual([expectedHstsDirective])
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(firstApiRuleIndex).toBeGreaterThan(headerIndex)
    expect(hstsLines[0]?.includes('env=')).toBe(false)
    expect(hstsLines[0]?.includes('setifempty')).toBe(false)
  })

  it('covers the denied response classes under the current rewrite rules', () => {
    expect(classifyRoute('/')).toBe('spa-fallback')
    expect(classifyRoute('/favicon.svg')).toBe('dist-file')
    expect(classifyRoute('/api/README.md')).toBe('api-direct-static-file')
    expect(classifyRoute('/api/catalog/entries')).toBe('api-extensionless-php')
    expect(classifyRoute('/api/catalog/entries.php')).toBe('api-direct-php-file')
    expect(classifyRoute('/api/catalog/does-not-exist')).toBe('api-passthrough')
  })

  it('routes unmatched API paths to a PHP handler that emits security headers', () => {
    const notFoundHandler = resolve(repoRoot, 'api/not-found.php')

    expect(isFile(notFoundHandler)).toBe(true)
    expect(
      activeLines.some((line) => line.includes('api/not-found.php')),
    ).toBe(true)
  })
})
