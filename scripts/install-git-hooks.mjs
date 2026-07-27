#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const gitDirectory = resolve(repoRoot, '.git')
const hooksDirectory = resolve(repoRoot, '.githooks')

if (process.env.CI) {
  console.log('Skipping Git hook installation in CI.')
  process.exit(0)
}

if (!existsSync(gitDirectory) || !existsSync(hooksDirectory)) {
  console.log('Skipping Git hook installation outside a Git checkout.')
  process.exit(0)
}

try {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  console.log('Configured Git hooks to use .githooks/.')
} catch (error) {
  console.warn(
    'Unable to configure Git hooks automatically. Run `npm run hooks:install` manually if needed.',
  )
  process.exit(0)
}
