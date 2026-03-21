import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { xContentTypeOptionsValue } from './support/x-content-type-options'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedXContentTypeOptionsDirective =
  `Header always set X-Content-Type-Options "${xContentTypeOptionsValue}"`

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActiveXContentTypeOptionsDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      line.startsWith('Header ') && line.includes('X-Content-Type-Options'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const xContentTypeOptionsDirectives =
  getActiveXContentTypeOptionsDirectives(activeLines)

describe('root .htaccess X-Content-Type-Options policy', () => {
  it('defines exactly one X-Content-Type-Options nosniff directive via mod_headers', () => {
    expect(xContentTypeOptionsDirectives).toEqual([
      expectedXContentTypeOptionsDirective,
    ])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedXContentTypeOptionsDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the nosniff directive before rewrites so the edge policy covers HTML, static, and API responses', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedXContentTypeOptionsDirective,
    )
    const rewriteIndex = normalizedLines.findIndex((line) =>
      line.startsWith('RewriteCond %{HTTPS} '),
    )

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeLessThan(rewriteIndex)
  })

  it('avoids conditional or setifempty variants that would leave some responses uncovered', () => {
    expect(
      xContentTypeOptionsDirectives.some((line) => /\benv=!?/u.test(line)),
    ).toBe(false)
    expect(
      xContentTypeOptionsDirectives.some((line) => line.includes('setifempty')),
    ).toBe(false)
  })
})
