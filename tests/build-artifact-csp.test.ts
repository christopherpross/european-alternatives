import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, it } from 'vitest'
import { build, mergeConfig } from 'vite'

import viteConfig from '../vite.config'
import {
  expectFallbackShellCspCompatibility,
  expectMainAppShellCspCompatibility,
} from './support/html-csp'

const tempBuildDir = mkdtempSync(join(tmpdir(), 'euroalt-csp-build-'))

let builtIndexSource = ''
let builtNotFoundSource = ''

beforeAll(async () => {
  await build(mergeConfig(viteConfig, {
    logLevel: 'silent',
    build: {
      outDir: tempBuildDir,
      emptyOutDir: true,
    },
  }))

  builtIndexSource = readFileSync(join(tempBuildDir, 'index.html'), 'utf8')
  builtNotFoundSource = readFileSync(join(tempBuildDir, '404.html'), 'utf8')
}, 120_000)

afterAll(() => {
  rmSync(tempBuildDir, { recursive: true, force: true })
})

describe('build artifact CSP compatibility', () => {
  it('keeps the generated main HTML shell free of inline scripts and styles', () => {
    expectMainAppShellCspCompatibility(builtIndexSource)
  })

  it('keeps the generated 404 fallback free of inline scripts and ships a meta CSP', () => {
    expectFallbackShellCspCompatibility(builtNotFoundSource)
  })
})
