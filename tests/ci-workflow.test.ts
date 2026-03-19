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
})
