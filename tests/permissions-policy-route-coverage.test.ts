import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { permissionsPolicyValue } from './support/permissions-policy'

const htaccessSource = readFileSync(resolve('.htaccess'), 'utf8')
const expectedPermissionsPolicyDirective =
  `Header always set Permissions-Policy "${permissionsPolicyValue}"`
const firstApiRewriteCondition = 'RewriteCond %{REQUEST_URI} ^/api/ [NC]'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('Permissions-Policy route coverage', () => {
  it('keeps the edge Permissions-Policy directive unconditional so every route is covered', () => {
    const permissionsPolicyLines = activeLines.filter((line) =>
      line.startsWith('Header always set Permissions-Policy '),
    )
    const headerIndex = activeLines.indexOf(expectedPermissionsPolicyDirective)
    const firstApiRuleIndex = activeLines.indexOf(firstApiRewriteCondition)

    expect(permissionsPolicyLines).toEqual([expectedPermissionsPolicyDirective])
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(firstApiRuleIndex).toBeGreaterThan(headerIndex)
    expect(permissionsPolicyLines[0]?.includes('env=')).toBe(false)
    expect(permissionsPolicyLines[0]?.includes('setifempty')).toBe(false)
  })

  it('is consistent with the PHP constant value', () => {
    const bootstrapSource = readFileSync(resolve('api/bootstrap.php'), 'utf8')

    const match = bootstrapSource.match(
      /const\s+PERMISSIONS_POLICY_HEADER_VALUE\s*=\s*'([^']+)'/u,
    )
    expect(match).not.toBeNull()

    const phpValue = match![1]
    expect(expectedPermissionsPolicyDirective).toContain(phpValue)
  })
})
