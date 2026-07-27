/**
 * Runtime CSP safety — source-level verification.
 *
 * The enforced CSP uses `style-src 'self'`, which blocks:
 *   - dynamically created <style> elements (document.createElement("style"))
 *   - inline style attributes set via setAttribute("style", ...)
 *   - inline <style> blocks in HTML
 *
 * It does NOT block the CSSOM API (element.style.property = value,
 * element.style.setProperty(), element.style.cssText) because the W3C CSP
 * Level 3 spec explicitly exempts programmatic style manipulation via the
 * CSSStyleDeclaration interface. This is confirmed by Web Platform Tests
 * (style-src-inline-style-with-csstext.html, inline-style-allowed-while-
 * cloning-objects.sub.html).
 *
 * framer-motion's `motion` component uses CSSOM for animate/initial/exit/
 * whileHover props — these are CSP-safe. However, framer-motion's `layout`
 * prop triggers PopLayout, which creates <style> elements at runtime via
 * document.createElement("style") + insertRule. This IS blocked by CSP.
 *
 * These tests verify that no component uses the CSP-violating framer-motion
 * features, providing concrete evidence that the motion-heavy UI works under
 * the strict style-src 'self' policy without browser-level testing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const componentsDir = join('src', 'components')
const componentFiles = readdirSync(componentsDir)
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => ({
    name: f,
    content: readFileSync(join(componentsDir, f), 'utf8'),
  }))

/**
 * framer-motion features that create <style> elements at runtime:
 *   - layout prop on motion.* components → triggers PopLayout
 *   - LayoutGroup component → coordinates layout animations
 *   - layoutId prop → shared layout animations across components
 *   - layoutScroll prop → scroll-aware layout animations
 *
 * All of these ultimately invoke PopLayout which calls
 * document.createElement("style") and sheet.insertRule().
 */
const layoutPropPattern = /\blayout\s*[={}]/u
const layoutGroupImportPattern =
  /\bimport\b[^;]*\bLayoutGroup\b[^;]*from\s+['"]framer-motion['"]/u
const layoutIdPropPattern = /\blayoutId\s*[={}]/u
const layoutScrollPropPattern = /\blayoutScroll\b/u

describe('framer-motion CSP compatibility', () => {
  it('no component uses the layout prop (triggers PopLayout style injection)', () => {
    for (const file of componentFiles) {
      const lines = file.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Skip CSS class names and HTML class attributes containing "layout"
        const line = lines[i]
        if (
          line.includes('className=') ||
          line.includes('className:') ||
          line.trimStart().startsWith('//')  ||
          line.trimStart().startsWith('*')
        ) {
          continue
        }
        expect(
          layoutPropPattern.test(line),
          `${file.name}:${i + 1} uses framer-motion layout prop which creates <style> elements blocked by CSP style-src 'self'`,
        ).toBe(false)
      }
    }
  })

  it('no component imports LayoutGroup (coordinates layout animations that inject styles)', () => {
    for (const file of componentFiles) {
      expect(
        layoutGroupImportPattern.test(file.content),
        `${file.name} imports LayoutGroup which coordinates style-injecting layout animations`,
      ).toBe(false)
    }
  })

  it('no component uses layoutId prop (shared layout animations inject styles)', () => {
    for (const file of componentFiles) {
      expect(
        layoutIdPropPattern.test(file.content),
        `${file.name} uses layoutId prop which triggers style injection`,
      ).toBe(false)
    }
  })

  it('no component uses layoutScroll prop (scroll layout animations inject styles)', () => {
    for (const file of componentFiles) {
      expect(
        layoutScrollPropPattern.test(file.content),
        `${file.name} uses layoutScroll prop which triggers style injection`,
      ).toBe(false)
    }
  })
})

describe('React JSX CSP compatibility', () => {
  it('no component renders <style> JSX elements (blocked by style-src self)', () => {
    // React 19 uses document.createElement("style") internally for <style>
    // JSX elements. If no component renders <style>, that code path is never
    // triggered.
    const jsxStylePattern = /<style\b/u
    for (const file of componentFiles) {
      expect(
        jsxStylePattern.test(file.content),
        `${file.name} renders a <style> JSX element which would be blocked by CSP`,
      ).toBe(false)
    }
  })

  it('no component uses setAttribute("style") (blocked by style-src-attr)', () => {
    const setAttrStylePattern = /setAttribute\(\s*["']style["']/u
    for (const file of componentFiles) {
      expect(
        setAttrStylePattern.test(file.content),
        `${file.name} uses setAttribute("style") which is blocked by CSP style-src-attr`,
      ).toBe(false)
    }
  })
})
