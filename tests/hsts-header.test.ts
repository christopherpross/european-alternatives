import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedHstsDirective =
  'Header always setifempty Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('root .htaccess HSTS policy', () => {
  it('defines exactly one preload-ready HSTS directive via mod_headers', () => {
    const hstsLines = activeLines.filter((line) =>
      line.startsWith('Header always setifempty Strict-Transport-Security '),
    )

    expect(hstsLines).toEqual([expectedHstsDirective])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedHstsDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the preload-ready directive in the repo-controlled edge policy before rewrites', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedHstsDirective,
    )
    const rewriteIndex = normalizedLines.findIndex((line) =>
      line.startsWith('RewriteCond %{HTTPS} '),
    )

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeLessThan(rewriteIndex)
    expect(activeLines.some((line) => line.includes('includeSubDomains'))).toBe(
      true,
    )
    expect(activeLines.some((line) => line.includes('preload'))).toBe(true)
  })

  it('uses setifempty so edge config does not duplicate the PHP HSTS fallback', () => {
    expect(activeLines).toContain(expectedHstsDirective)
    expect(activeLines).not.toContain(
      'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"',
    )
  })
})
