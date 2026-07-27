import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedHstsDirective =
  'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"'
const legacySetIfEmptyDirective =
  'Header always setifempty Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"'
const guardedApiDirective =
  'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" env=!IS_API_REQUEST'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActiveHstsDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      line.startsWith('Header ') && line.includes('Strict-Transport-Security'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const hstsDirectives = getActiveHstsDirectives(activeLines)

describe('root .htaccess HSTS policy', () => {
  it('defines exactly one preload-ready HSTS directive via mod_headers', () => {
    expect(hstsDirectives).toEqual([expectedHstsDirective])
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

  it('avoids host-specific or route-guarded variants that would leave some responses uncovered', () => {
    expect(hstsDirectives).toContain(expectedHstsDirective)
    expect(hstsDirectives).not.toContain(legacySetIfEmptyDirective)
    expect(hstsDirectives).not.toContain(guardedApiDirective)
    expect(hstsDirectives.some((line) => /\benv=!?/u.test(line))).toBe(false)
    expect(hstsDirectives.some((line) => line.includes('setifempty'))).toBe(false)
  })
})
