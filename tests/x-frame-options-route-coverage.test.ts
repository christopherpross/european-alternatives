import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const htaccessSource = readFileSync(resolve('.htaccess'), 'utf8')
const expectedXfoDirective = 'Header always set X-Frame-Options "DENY"'
const firstApiRewriteCondition = 'RewriteCond %{REQUEST_URI} ^/api/ [NC]'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('X-Frame-Options route coverage', () => {
  it('keeps the edge X-Frame-Options directive unconditional so every route is covered', () => {
    const xfoLines = activeLines.filter((line) =>
      line.startsWith('Header always set X-Frame-Options '),
    )
    const headerIndex = activeLines.indexOf(expectedXfoDirective)
    const firstApiRuleIndex = activeLines.indexOf(firstApiRewriteCondition)

    expect(xfoLines).toEqual([expectedXfoDirective])
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(firstApiRuleIndex).toBeGreaterThan(headerIndex)
    expect(xfoLines[0]?.includes('env=')).toBe(false)
    expect(xfoLines[0]?.includes('setifempty')).toBe(false)
  })

  it('is consistent with the PHP constant value', () => {
    const bootstrapSource = readFileSync(
      resolve('api/bootstrap.php'),
      'utf8',
    )

    const match = bootstrapSource.match(
      /const\s+X_FRAME_OPTIONS_HEADER_VALUE\s*=\s*'([^']+)'/u,
    )
    expect(match).not.toBeNull()

    const phpValue = match![1]
    expect(expectedXfoDirective).toContain(phpValue)
  })
})
