import { expect } from 'vitest'

// The canonical CSP policy enforced by .htaccess and PHP API responses.
// If this value drifts from .htaccess, tests/csp-header.test.ts will fail.
export const enforcedCspPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"

export const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>/iu
export const inlineStyleTagPattern = /<style\b/iu
export const inlineStyleAttributePattern = /\sstyle=/iu

// Matches protocol-relative (//host/...) or absolute (scheme://...) URLs.
const crossOriginUrlPattern = /^\/\/|^[a-z][a-z0-9+.-]*:/iu

function extractScriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)].map(
    (m) => m[1],
  )
}

function extractStylesheetHrefs(html: string): string[] {
  const hrefs: string[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0]
    if (/\brel=["']stylesheet["']/iu.test(tag)) {
      const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/iu)
      if (hrefMatch) {
        hrefs.push(hrefMatch[1])
      }
    }
  }
  return hrefs
}

function parseCspDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>()
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (trimmed) {
      const spaceIndex = trimmed.indexOf(' ')
      if (spaceIndex === -1) {
        directives.set(trimmed.toLowerCase(), '')
      } else {
        directives.set(
          trimmed.slice(0, spaceIndex).toLowerCase(),
          trimmed.slice(spaceIndex + 1),
        )
      }
    }
  }
  return directives
}

export function expectHtmlToBeInlineFree(html: string): void {
  expect(html).not.toMatch(inlineScriptPattern)
  expect(html).not.toMatch(inlineStyleTagPattern)
  expect(html).not.toMatch(inlineStyleAttributePattern)
}

/**
 * Asserts that every <script src> and <link rel="stylesheet" href> URL in the
 * HTML is same-origin (relative path). Cross-origin resources would be blocked
 * by the enforced CSP script-src 'self' / style-src 'self'.
 */
export function expectAllResourceUrlsAreSameOrigin(html: string): void {
  const allUrls = [...extractScriptSrcs(html), ...extractStylesheetHrefs(html)]
  for (const url of allUrls) {
    expect(
      crossOriginUrlPattern.test(url),
      `Resource URL "${url}" is cross-origin and would be blocked by CSP`,
    ).toBe(false)
  }
}

/**
 * Asserts that the <meta http-equiv="Content-Security-Policy"> tag's content
 * is consistent with the enforced header policy. Every directive present in
 * the meta CSP must match its counterpart in the enforced policy, and no
 * unsafe source values may appear.
 */
export function expectMetaCspMatchesEnforcedPolicy(html: string): void {
  // Try double-quoted content first (CSP values contain single quotes like 'self').
  const metaMatch =
    html.match(
      /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]+)"/iu,
    ) ??
    html.match(
      /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content='([^']+)'/iu,
    )
  expect(metaMatch, 'Expected a <meta> CSP tag').not.toBeNull()

  const metaCsp = metaMatch![1]
  const metaDirectives = parseCspDirectives(metaCsp)
  const enforcedDirectives = parseCspDirectives(enforcedCspPolicy)

  // Every directive present in the meta CSP must match the enforced version.
  for (const [directive, metaValue] of metaDirectives) {
    const enforcedValue = enforcedDirectives.get(directive)
    expect(
      enforcedValue,
      `Meta CSP directive "${directive}" has no counterpart in the enforced header policy`,
    ).toBeDefined()
    expect(
      metaValue,
      `Meta CSP directive "${directive}: ${metaValue}" does not match enforced "${directive}: ${enforcedValue}"`,
    ).toBe(enforcedValue)
  }

  // The meta CSP must include at least default-src and script-src.
  expect(
    metaDirectives.has('default-src'),
    'Meta CSP must include default-src',
  ).toBe(true)
  expect(
    metaDirectives.has('script-src'),
    'Meta CSP must include script-src',
  ).toBe(true)

  // No unsafe source values allowed.
  expect(metaCsp).not.toContain("'unsafe-inline'")
  expect(metaCsp).not.toContain("'unsafe-eval'")
}

export function expectMainAppShellCspCompatibility(html: string): void {
  expect(html).toContain('/app-shell.js')
  expect(html).toContain('/app-shell.css')
  expectHtmlToBeInlineFree(html)
  expectAllResourceUrlsAreSameOrigin(html)
}

export function expectFallbackShellCspCompatibility(html: string): void {
  expect(html).toContain('<meta http-equiv="Content-Security-Policy"')
  expect(html).toContain('/404-redirect.js')
  expectHtmlToBeInlineFree(html)
  expectAllResourceUrlsAreSameOrigin(html)
  expectMetaCspMatchesEnforcedPolicy(html)
}
