import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { xContentTypeOptionsValue } from './support/x-content-type-options'

const htaccessSource = readFileSync(resolve('.htaccess'), 'utf8')
const expectedXContentTypeOptionsDirective =
  `Header always set X-Content-Type-Options "${xContentTypeOptionsValue}"`
const firstApiRewriteCondition = 'RewriteCond %{REQUEST_URI} ^/api/ [NC]'

function getActiveHtaccessLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

const activeLines = getActiveHtaccessLines(htaccessSource)

describe('X-Content-Type-Options route coverage', () => {
  it('keeps the edge X-Content-Type-Options directive unconditional so every route is covered', () => {
    const xContentTypeOptionsLines = activeLines.filter((line) =>
      line.startsWith('Header always set X-Content-Type-Options '),
    )
    const headerIndex = activeLines.indexOf(expectedXContentTypeOptionsDirective)
    const firstApiRuleIndex = activeLines.indexOf(firstApiRewriteCondition)

    expect(xContentTypeOptionsLines).toEqual([
      expectedXContentTypeOptionsDirective,
    ])
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(firstApiRuleIndex).toBeGreaterThan(headerIndex)
    expect(xContentTypeOptionsLines[0]?.includes('env=')).toBe(false)
    expect(xContentTypeOptionsLines[0]?.includes('setifempty')).toBe(false)
  })

  it('is consistent with the PHP constant value', () => {
    const bootstrapSource = readFileSync(resolve('api/bootstrap.php'), 'utf8')

    const match = bootstrapSource.match(
      /const\s+X_CONTENT_TYPE_OPTIONS_HEADER_VALUE\s*=\s*'([^']+)'/u,
    )
    expect(match).not.toBeNull()

    const phpValue = match![1]
    expect(expectedXContentTypeOptionsDirective).toContain(phpValue)
  })
})
