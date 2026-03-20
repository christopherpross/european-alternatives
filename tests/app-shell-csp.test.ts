import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const indexSource = readFileSync(resolve('index.html'), 'utf8')
const notFoundSource = readFileSync(resolve('public/404.html'), 'utf8')
const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>/iu
const inlineStyleTagPattern = /<style\b/iu
const inlineStyleAttributePattern = /\sstyle=/iu

describe('app shell CSP compatibility', () => {
  it('keeps the main HTML shell free of inline scripts and styles', () => {
    expect(indexSource).toContain('<script src="/app-shell.js"></script>')
    expect(indexSource).toContain('<link rel="stylesheet" href="/app-shell.css" />')
    expect(indexSource).not.toMatch(inlineScriptPattern)
    expect(indexSource).not.toMatch(inlineStyleTagPattern)
    expect(indexSource).not.toMatch(inlineStyleAttributePattern)
    expect(existsSync(resolve('public/app-shell.js'))).toBe(true)
    expect(existsSync(resolve('public/app-shell.css'))).toBe(true)
  })

  it('keeps the GitHub Pages fallback free of inline scripts and ships a meta CSP', () => {
    expect(notFoundSource).toContain(
      '<meta http-equiv="Content-Security-Policy"',
    )
    expect(notFoundSource).toContain('<script src="/404-redirect.js"></script>')
    expect(notFoundSource).not.toMatch(inlineScriptPattern)
    expect(notFoundSource).not.toMatch(inlineStyleTagPattern)
    expect(notFoundSource).not.toMatch(inlineStyleAttributePattern)
    expect(existsSync(resolve('public/404-redirect.js'))).toBe(true)
  })
})
