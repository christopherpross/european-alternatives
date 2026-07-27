import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { referrerPolicyValue } from './support/referrer-policy'

const htaccessSource = readFileSync(resolve('.htaccess'), 'utf8')
const expectedReferrerPolicyDirective =
  `Header always set Referrer-Policy "${referrerPolicyValue}"`
const firstApiRewriteCondition = 'RewriteCond %{REQUEST_URI} ^/api/ [NC]'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('Referrer-Policy route coverage', () => {
  it('keeps the edge Referrer-Policy directive unconditional so every route is covered', () => {
    const referrerPolicyLines = activeLines.filter((line) =>
      line.startsWith('Header always set Referrer-Policy '),
    )
    const headerIndex = activeLines.indexOf(expectedReferrerPolicyDirective)
    const firstApiRuleIndex = activeLines.indexOf(firstApiRewriteCondition)

    expect(referrerPolicyLines).toEqual([expectedReferrerPolicyDirective])
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(firstApiRuleIndex).toBeGreaterThan(headerIndex)
    expect(referrerPolicyLines[0]?.includes('env=')).toBe(false)
    expect(referrerPolicyLines[0]?.includes('setifempty')).toBe(false)
  })

  it('is consistent with the PHP constant value', () => {
    const bootstrapSource = readFileSync(resolve('api/bootstrap.php'), 'utf8')

    const match = bootstrapSource.match(
      /const\s+REFERRER_POLICY_HEADER_VALUE\s*=\s*'([^']+)'/u,
    )
    expect(match).not.toBeNull()

    const phpValue = match![1]
    expect(expectedReferrerPolicyDirective).toContain(phpValue)
  })
})
