import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedXfoDirective = 'Header always set X-Frame-Options "DENY"'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActiveXfoDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      line.startsWith('Header ') && line.includes('X-Frame-Options'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const xfoDirectives = getActiveXfoDirectives(activeLines)

describe('root .htaccess X-Frame-Options policy', () => {
  it('defines exactly one X-Frame-Options DENY directive via mod_headers', () => {
    expect(xfoDirectives).toEqual([expectedXfoDirective])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedXfoDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the X-Frame-Options directive before rewrites', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedXfoDirective,
    )
    const rewriteIndex = normalizedLines.findIndex((line) =>
      line.startsWith('RewriteCond %{HTTPS} '),
    )

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeLessThan(rewriteIndex)
  })

  it('uses DENY (not SAMEORIGIN) since no framing is needed', () => {
    expect(xfoDirectives[0]).toContain('DENY')
    expect(xfoDirectives[0]).not.toContain('SAMEORIGIN')
    expect(xfoDirectives[0]).not.toContain('ALLOW-FROM')
  })

  it('avoids conditional or setifempty variants', () => {
    expect(xfoDirectives.some((line) => /\benv=!?/u.test(line))).toBe(false)
    expect(xfoDirectives.some((line) => line.includes('setifempty'))).toBe(
      false,
    )
  })
})
