import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  expectFallbackShellCspCompatibility,
  expectMainAppShellCspCompatibility,
} from './support/html-csp'
import { expectMetaReferrerPolicy } from './support/referrer-policy'

const indexSource = readFileSync(resolve('index.html'), 'utf8')
const notFoundSource = readFileSync(resolve('public/404.html'), 'utf8')

describe('app shell CSP compatibility', () => {
  it('keeps the main HTML shell free of inline scripts and styles', () => {
    expectMainAppShellCspCompatibility(indexSource)
    expectMetaReferrerPolicy(indexSource)
    expect(existsSync(resolve('public/app-shell.js'))).toBe(true)
    expect(existsSync(resolve('public/app-shell.css'))).toBe(true)
  })

  it('keeps the GitHub Pages fallback free of inline scripts and ships a meta CSP', () => {
    expectFallbackShellCspCompatibility(notFoundSource)
    expectMetaReferrerPolicy(notFoundSource)
    expect(existsSync(resolve('public/404-redirect.js'))).toBe(true)
  })
})
