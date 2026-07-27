#!/usr/bin/env node

import {
  listStagedFiles,
  listTrackedFiles,
  scanFiles,
} from './lib/secret-scan.mjs'

function parseArguments(argv) {
  const explicitPaths = []
  let mode = 'tracked'

  for (const argument of argv) {
    if (argument === '--staged') {
      mode = 'staged'
      continue
    }

    if (argument === '--tracked') {
      mode = 'tracked'
      continue
    }

    explicitPaths.push(argument)
  }

  return { explicitPaths, mode }
}

function formatFinding(finding) {
  if (typeof finding.line === 'number') {
    return `- ${finding.path}:${finding.line} matched ${finding.ruleId}: ${finding.message}`
  }

  return `- ${finding.path} matched ${finding.ruleId}: ${finding.message}`
}

function main() {
  const { explicitPaths, mode } = parseArguments(process.argv.slice(2))
  const source = mode === 'staged' ? 'staged' : 'workingTree'
  const targets =
    explicitPaths.length > 0
      ? explicitPaths
      : mode === 'staged'
        ? listStagedFiles()
        : listTrackedFiles()

  if (targets.length === 0) {
    console.log('Secret scan passed: no files to scan.')
    process.exit(0)
  }

  const findings = scanFiles(targets, { source })

  if (findings.length === 0) {
    const scope = explicitPaths.length > 0 ? 'explicit' : mode
    const suffix = targets.length === 1 ? '' : 's'

    console.log(`Secret scan passed for ${targets.length} ${scope} file${suffix}.`)
    process.exit(0)
  }

  const scope = explicitPaths.length > 0 ? 'selected files' : `${mode} changes`

  console.error(
    `Secret scan failed for ${scope}. Remove the secret-like paths or values below before continuing:`,
  )

  for (const finding of findings) {
    console.error(formatFinding(finding))
  }

  process.exit(1)
}

main()
