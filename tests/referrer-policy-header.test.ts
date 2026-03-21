import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { referrerPolicyValue } from './support/referrer-policy'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedReferrerPolicyDirective =
  `Header always set Referrer-Policy "${referrerPolicyValue}"`

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActiveReferrerPolicyDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) => line.startsWith('Header ') && line.includes('Referrer-Policy'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const referrerPolicyDirectives =
  getActiveReferrerPolicyDirectives(activeLines)

describe('root .htaccess Referrer-Policy', () => {
  it('defines exactly one Referrer-Policy directive via mod_headers', () => {
    expect(referrerPolicyDirectives).toEqual([expectedReferrerPolicyDirective])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedReferrerPolicyDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the directive before rewrites so the edge policy covers HTML, static, and API responses', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedReferrerPolicyDirective,
    )
    const rewriteIndex = normalizedLines.findIndex((line) =>
      line.startsWith('RewriteCond %{HTTPS} '),
    )

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeLessThan(rewriteIndex)
  })

  it('avoids conditional or setifempty variants that would leave some responses uncovered', () => {
    expect(referrerPolicyDirectives.some((line) => /\benv=!?/u.test(line))).toBe(
      false,
    )
    expect(
      referrerPolicyDirectives.some((line) => line.includes('setifempty')),
    ).toBe(false)
  })
})
