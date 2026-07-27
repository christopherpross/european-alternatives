import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dependabotConfigUrl = new URL('../.github/dependabot.yml', import.meta.url)
const workflowsDirectoryUrl = new URL('../.github/workflows/', import.meta.url)
const validationWorkflowUrl = new URL(
  '../.github/workflows/validate.yml',
  import.meta.url,
)
const deployWorkflowUrl = new URL(
  '../.github/workflows/deploy.yml',
  import.meta.url,
)

function readWorkflow(url: URL): string {
  return readFileSync(url, 'utf8')
}

function readWorkflowFiles(): Array<{ name: string; workflow: string }> {
  return readdirSync(workflowsDirectoryUrl, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .map((entry) => ({
      name: entry.name,
      workflow: readWorkflow(new URL(entry.name, workflowsDirectoryUrl)),
    }))
}

function getActionUses(
  workflow: string,
): Array<{ action: string; ref: string; versionComment?: string }> {
  return Array.from(
    workflow.matchAll(
      /^\s*uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s#]+)(?:\s+#\s+([^\n]+))?$/gmu,
    ),
    ([, action, ref, versionComment]) => ({
      action,
      ref,
      versionComment,
    }),
  )
}

function getCommandIndex(workflow: string, command: string): number {
  const index = workflow.indexOf(`run: ${command}`)

  expect(index).toBeGreaterThan(-1)

  return index
}

function getJobBlock(workflow: string, jobName: string): string {
  const jobBlockPattern = new RegExp(
    `\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`,
    'u',
  )
  const match = workflow.match(jobBlockPattern)

  expect(match).not.toBeNull()

  return match![0]
}

function getJobTimeoutMinutes(jobBlock: string): number {
  const timeoutMatch = jobBlock.match(/timeout-minutes:\s*(\d+)/u)

  expect(timeoutMatch).not.toBeNull()

  return Number.parseInt(timeoutMatch![1], 10)
}

function getWorkflowHeader(workflow: string): string {
  const [header] = workflow.split('\njobs:\n', 1)

  expect(header).toBeDefined()

  return header
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function getDependabotUpdateBlock(config: string, ecosystem: string): string {
  const updateBlockPattern = new RegExp(
    `(?:^|\\n)  - package-ecosystem: ${escapeRegExp(ecosystem)}\\n([\\s\\S]*?)(?=\\n  - package-ecosystem:|$)`,
    'u',
  )
  const match = config.match(updateBlockPattern)

  expect(match, `Dependabot should configure ${ecosystem}`).not.toBeNull()

  return match![0]
}

describe('validation workflow', () => {
  it('runs on pull requests, pushes to main, and a weekly schedule', () => {
    const workflow = readWorkflow(validationWorkflowUrl)

    expect(workflow).toContain('schedule:')
    expect(workflow).toContain("- cron: '17 5 * * 1'")
    expect(workflow).toContain('pull_request:')
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\['main'\]/)
  })

  it('skips CI-generated dist rebuild commits on push', () => {
    const workflow = readWorkflow(validationWorkflowUrl)

    expect(workflow).toContain(
      "if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[skip ci]')",
    )
  })

  it('runs the secret scan before audit, tests, typecheck, lint, and build', () => {
    const workflow = readWorkflow(validationWorkflowUrl)
    const secretScan = getCommandIndex(workflow, 'npm run secrets:scan')
    const audit = getCommandIndex(workflow, 'npm audit --audit-level=high')
    const test = getCommandIndex(workflow, 'npm test')
    const typecheck = getCommandIndex(
      workflow,
      'npx tsc --noEmit --project tsconfig.app.json',
    )
    const lint = getCommandIndex(workflow, 'npm run lint')
    const build = getCommandIndex(workflow, 'npm run build')

    expect(secretScan).toBeLessThan(audit)
    expect(audit).toBeLessThan(test)
    expect(test).toBeLessThan(typecheck)
    expect(typecheck).toBeLessThan(lint)
    expect(lint).toBeLessThan(build)
  })
})

describe('dependabot configuration', () => {
  it('configures a weekly npm update run', () => {
    const config = readWorkflow(dependabotConfigUrl)
    const npmUpdate = getDependabotUpdateBlock(config, 'npm')

    expect(config).toContain('version: 2')
    expect(npmUpdate).toContain('directory: /')
    expect(npmUpdate).toContain('interval: weekly')
    expect(npmUpdate).toContain('day: monday')
    expect(npmUpdate).toContain("time: '06:00'")
    expect(npmUpdate).toContain('timezone: Europe/Berlin')
    expect(npmUpdate).toContain('open-pull-requests-limit: 10')
    expect(npmUpdate).toContain('labels:')
    expect(npmUpdate).toContain('- dependencies')
    expect(npmUpdate).toContain('npm-minor-and-patch:')
    expect(npmUpdate).toContain('- minor')
    expect(npmUpdate).toContain('- patch')
  })

  it('configures a weekly GitHub Actions update run', () => {
    const config = readWorkflow(dependabotConfigUrl)
    const githubActionsUpdate = getDependabotUpdateBlock(
      config,
      'github-actions',
    )

    expect(config).toContain('version: 2')
    expect(githubActionsUpdate).toContain('directory: /')
    expect(githubActionsUpdate).toContain('interval: weekly')
    expect(githubActionsUpdate).toContain('day: monday')
    expect(githubActionsUpdate).toContain("time: '06:30'")
    expect(githubActionsUpdate).toContain('timezone: Europe/Berlin')
    expect(githubActionsUpdate).toContain('open-pull-requests-limit: 10')
    expect(githubActionsUpdate).toContain('labels:')
    expect(githubActionsUpdate).toContain('- dependencies')
    expect(githubActionsUpdate).toContain('- ci')
    expect(githubActionsUpdate).toContain('github-actions-minor-and-patch:')
    expect(githubActionsUpdate).toContain('- minor')
    expect(githubActionsUpdate).toContain('- patch')
  })

  it('scopes npm labels without the CI-specific tag', () => {
    const config = readWorkflow(dependabotConfigUrl)
    const npmUpdate = getDependabotUpdateBlock(config, 'npm')

    expect(npmUpdate).not.toContain('- ci')
  })
})

describe('workflow action pinning', () => {
  it('pins every GitHub Action to a full commit SHA with a release comment', () => {
    const workflowFiles = readWorkflowFiles()

    expect(workflowFiles.length).toBeGreaterThan(0)

    for (const { name, workflow } of workflowFiles) {
      const actionUses = getActionUses(workflow)

      expect(actionUses.length, `${name} should reference at least one action`).toBeGreaterThan(0)

      for (const usage of actionUses) {
        expect(usage.ref, `${name} should pin ${usage.action}`).toMatch(
          /^[0-9a-f]{40}$/u,
        )
        expect(
          usage.versionComment,
          `${name} should keep a human-readable release comment for ${usage.action}`,
        ).toMatch(/^v\d+\.\d+\.\d+$/u)
      }
    }
  })
})

describe('deploy workflow', () => {
  it('runs on pushes to main and manual dispatches', () => {
    const workflow = readWorkflow(deployWorkflowUrl)

    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\['main'\]/)
    expect(workflow).toContain('workflow_dispatch:')
  })

  it('skips CI-generated dist rebuild commits on push', () => {
    const workflow = readWorkflow(deployWorkflowUrl)

    expect(workflow).toContain(
      `if: "!contains(github.event.head_commit.message, '[skip ci]')"`,
    )
  })

  it('runs the secret scan and validation gate before building and publishing dist', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const secretScan = getCommandIndex(workflow, 'npm run secrets:scan')
    const audit = getCommandIndex(workflow, 'npm audit --audit-level=high')
    const test = getCommandIndex(workflow, 'npm test')
    const typecheck = getCommandIndex(
      workflow,
      'npx tsc --noEmit --project tsconfig.app.json',
    )
    const lint = getCommandIndex(workflow, 'npm run lint')
    const build = getCommandIndex(workflow, 'npm run build')
    const publish = workflow.indexOf('git add -f dist/')

    expect(secretScan).toBeLessThan(audit)
    expect(audit).toBeLessThan(test)
    expect(test).toBeLessThan(typecheck)
    expect(typecheck).toBeLessThan(lint)
    expect(lint).toBeLessThan(build)
    expect(build).toBeLessThan(publish)
  })

  it('deploys GitHub Pages only after the build job', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const deployJob = getJobBlock(workflow, 'deploy')

    expect(deployJob).toContain('needs: build')
    expect(deployJob).toContain('uses: actions/deploy-pages@')
  })

  it('scopes deploy permissions to the minimum required per job', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const workflowHeader = getWorkflowHeader(workflow)
    const buildJob = getJobBlock(workflow, 'build')
    const deployJob = getJobBlock(workflow, 'deploy')
    const verifyJob = getJobBlock(workflow, 'verify-production-security-headers')

    expect(workflowHeader).not.toContain('permissions:')
    expect(buildJob).toContain('permissions:')
    expect(buildJob).toContain('contents: write')
    expect(deployJob).toContain('permissions:')
    expect(deployJob).toContain('pages: write')
    expect(deployJob).toContain('id-token: write')
    expect(verifyJob).toContain('permissions:')
    expect(verifyJob).toContain('contents: read')
    expect(verifyJob).not.toContain('pages: write')
    expect(verifyJob).not.toContain('id-token: write')
  })

  it('verifies live Hostinger HSTS after deploy with the shared smoke test', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const verifyJob = getJobBlock(workflow, 'verify-production-security-headers')

    expect(verifyJob).toContain("if: github.ref == 'refs/heads/main'")
    expect(verifyJob).toContain('needs: deploy')
    expect(verifyJob).toContain('uses: actions/checkout@')
    expect(verifyJob).toContain('uses: actions/setup-node@')
    expect(verifyJob).toContain('run: npm ci')
    expect(verifyJob).toContain(
      'EUROALT_LIVE_BASE_URL: https://european-alternatives.cloud',
    )
    expect(verifyJob).toContain("EUROALT_LIVE_VERIFY_TIMEOUT_MS: '600000'")
    expect(verifyJob).toContain("EUROALT_LIVE_VERIFY_INTERVAL_MS: '15000'")
    expect(verifyJob).toContain(
      'run: npm test -- --run tests/hsts-live-deployment.test.ts',
    )
  })

  it('keeps enough timeout budget for all post-deploy live verification steps', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const verifyJob = getJobBlock(workflow, 'verify-production-security-headers')

    expect(getJobTimeoutMinutes(verifyJob)).toBeGreaterThanOrEqual(45)
  })

  it('verifies live Hostinger CSP-compatible HTML after deploy with the shared smoke test', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const verifyJob = getJobBlock(workflow, 'verify-production-security-headers')

    expect(verifyJob).toContain(
      'Verify live CSP-compatible HTML on Hostinger',
    )
    expect(verifyJob).toContain(
      'run: npm test -- --run tests/csp-live-deployment.test.ts',
    )
  })

  it('verifies live Hostinger X-Content-Type-Options after deploy with the shared smoke test', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const verifyJob = getJobBlock(workflow, 'verify-production-security-headers')

    expect(verifyJob).toContain(
      'Verify live X-Content-Type-Options on Hostinger',
    )
    expect(verifyJob).toContain(
      'run: npm test -- --run tests/x-content-type-options-live-deployment.test.ts',
    )
  })
})
