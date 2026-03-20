import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

describe('validation workflow', () => {
  it('runs on pull requests and pushes to main', () => {
    const workflow = readWorkflow(validationWorkflowUrl)

    expect(workflow).toContain('pull_request:')
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\['main'\]/)
  })

  it('skips CI-generated dist rebuild commits on push', () => {
    const workflow = readWorkflow(validationWorkflowUrl)

    expect(workflow).toContain(
      "if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[skip ci]')",
    )
  })

  it('runs audit, tests, typecheck, lint, and build', () => {
    const workflow = readWorkflow(validationWorkflowUrl)
    const audit = getCommandIndex(workflow, 'npm audit --audit-level=high')
    const test = getCommandIndex(workflow, 'npm test')
    const typecheck = getCommandIndex(
      workflow,
      'npx tsc --noEmit --project tsconfig.app.json',
    )
    const lint = getCommandIndex(workflow, 'npm run lint')
    const build = getCommandIndex(workflow, 'npm run build')

    expect(audit).toBeLessThan(test)
    expect(test).toBeLessThan(typecheck)
    expect(typecheck).toBeLessThan(lint)
    expect(lint).toBeLessThan(build)
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

  it('runs the validation gate before building and publishing dist', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const audit = getCommandIndex(workflow, 'npm audit --audit-level=high')
    const test = getCommandIndex(workflow, 'npm test')
    const typecheck = getCommandIndex(
      workflow,
      'npx tsc --noEmit --project tsconfig.app.json',
    )
    const lint = getCommandIndex(workflow, 'npm run lint')
    const build = getCommandIndex(workflow, 'npm run build')
    const publish = workflow.indexOf('git add -f dist/')

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
    expect(deployJob).toContain('uses: actions/deploy-pages@v4')
  })

  it('verifies live Hostinger HSTS after deploy with the shared smoke test', () => {
    const workflow = readWorkflow(deployWorkflowUrl)
    const verifyJob = getJobBlock(workflow, 'verify-production-hsts')

    expect(verifyJob).toContain("if: github.ref == 'refs/heads/main'")
    expect(verifyJob).toContain('needs: deploy')
    expect(verifyJob).toContain('uses: actions/checkout@v4')
    expect(verifyJob).toContain('uses: actions/setup-node@v4')
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
})
