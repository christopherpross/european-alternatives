import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedCspDirective =
  `Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"`

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActiveCspDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      line.startsWith('Header ') && line.includes('Content-Security-Policy'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const cspDirectives = getActiveCspDirectives(activeLines)

describe('root .htaccess CSP policy', () => {
  it('defines exactly one repo-owned CSP directive via mod_headers', () => {
    expect(cspDirectives).toEqual([expectedCspDirective])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedCspDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the CSP directive before rewrites so API and SPA responses share the edge policy', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedCspDirective,
    )
    const rewriteIndex = normalizedLines.findIndex((line) =>
      line.startsWith('RewriteCond %{HTTPS} '),
    )

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeLessThan(rewriteIndex)
  })

  it('stays strict and hashless after the shell scripts were externalized', () => {
    expect(cspDirectives[0]).toContain(`script-src 'self'`)
    expect(cspDirectives[0]).toContain(`style-src 'self'`)
    expect(cspDirectives[0]).toContain(`object-src 'none'`)
    expect(cspDirectives[0]).not.toContain(`'unsafe-inline'`)
    expect(cspDirectives[0]).not.toContain(`'unsafe-eval'`)
    expect(cspDirectives[0]).not.toContain(`'sha256-`)
  })
})
