import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsPolicyValue } from './support/permissions-policy'

const htaccessPath = resolve('.htaccess')
const htaccessSource = readFileSync(htaccessPath, 'utf8')
const normalizedLines = htaccessSource.split(/\r?\n/u).map((line) => line.trim())
const expectedPermissionsPolicyDirective =
  `Header always set Permissions-Policy "${permissionsPolicyValue}"`

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function getActivePermissionsPolicyDirectives(lines: string[]): string[] {
  return lines.filter(
    (line) => line.startsWith('Header ') && line.includes('Permissions-Policy'),
  )
}

const activeLines = getActiveHtaccessLines(htaccessSource)
const permissionsPolicyDirectives =
  getActivePermissionsPolicyDirectives(activeLines)

describe('root .htaccess Permissions-Policy', () => {
  it('defines exactly one Permissions-Policy directive via mod_headers', () => {
    expect(permissionsPolicyDirectives).toEqual([
      expectedPermissionsPolicyDirective,
    ])
    expect(activeLines).toContain('<IfModule mod_headers.c>')
    expect(activeLines).toContain('</IfModule>')

    const ifModuleIndex = activeLines.indexOf('<IfModule mod_headers.c>')
    const headerIndex = activeLines.indexOf(expectedPermissionsPolicyDirective)
    const closeIndex = activeLines.indexOf('</IfModule>')

    expect(ifModuleIndex).toBeGreaterThanOrEqual(0)
    expect(headerIndex).toBeGreaterThan(ifModuleIndex)
    expect(closeIndex).toBeGreaterThan(headerIndex)
  })

  it('keeps the directive before rewrites so the edge policy covers HTML, static, and API responses', () => {
    const headerIndex = normalizedLines.findIndex(
      (line) => line === expectedPermissionsPolicyDirective,
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
      permissionsPolicyDirectives.some((line) => /\benv=!?/u.test(line)),
    ).toBe(false)
    expect(
      permissionsPolicyDirectives.some((line) => line.includes('setifempty')),
    ).toBe(false)
  })
})
