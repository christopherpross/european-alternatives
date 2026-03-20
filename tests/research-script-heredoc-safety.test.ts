import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectDir = resolve('.')
const researchScriptPaths = [
  resolve('scripts/research-alternative.sh'),
  resolve('scripts/research-alternative-minimax.sh'),
]

const localResearchScripts = researchScriptPaths.flatMap((scriptPath) => {
  if (!existsSync(scriptPath)) {
    return []
  }

  return [{
    label: basename(scriptPath),
    path: scriptPath,
    text: readFileSync(scriptPath, 'utf8'),
  }]
})

function runBash(script: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-lc', script], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  })
}

function extractAssignmentBlock(scriptText: string, variableName: string, delimiter: string) {
  const startMarker = `${variableName}="$(cat <<${delimiter}`
  const endMarker = `\n${delimiter}\n)"`
  const startIndex = scriptText.indexOf(startMarker)

  if (startIndex === -1) {
    throw new Error(`Could not find ${variableName} heredoc start marker`)
  }

  const endIndex = scriptText.indexOf(endMarker, startIndex)

  if (endIndex === -1) {
    throw new Error(`Could not find ${variableName} heredoc end marker`)
  }

  return scriptText.slice(startIndex, endIndex + endMarker.length)
}

function buildResearchPrompt(scriptText: string, issueContextSection: string) {
  const researchPromptBlock = extractAssignmentBlock(scriptText, 'RESEARCH_PROMPT', 'RESEARCH_PROMPT_EOF')

  expect(researchPromptBlock).toContain('${ISSUE_CONTEXT_SECTION}')

  return runBash(
    [
      'set -euo pipefail',
      'SAFE_ALT_NAME="$SAFE_ALT_NAME_UNDER_TEST"',
      'CATEGORY_LIST="$CATEGORY_LIST_UNDER_TEST"',
      'CATEGORY_HINT_TEXT="$CATEGORY_HINT_TEXT_UNDER_TEST"',
      'ISSUE_CONTEXT_SECTION="$ISSUE_CONTEXT_SECTION_UNDER_TEST"',
      'COUNTRY_LIST="$COUNTRY_LIST_UNDER_TEST"',
      'US_VENDOR_LIST="$US_VENDOR_LIST_UNDER_TEST"',
      'DENIED_NAMES_LIST="$DENIED_NAMES_LIST_UNDER_TEST"',
      'WEB_SEARCH_INSTRUCTION="$WEB_SEARCH_INSTRUCTION_UNDER_TEST"',
      researchPromptBlock,
      'printf \'%s\' "$RESEARCH_PROMPT"',
    ].join('\n'),
    {
      SAFE_ALT_NAME_UNDER_TEST: 'Example Alternative',
      CATEGORY_LIST_UNDER_TEST: 'cloud-storage, design',
      CATEGORY_HINT_TEXT_UNDER_TEST: '',
      ISSUE_CONTEXT_SECTION_UNDER_TEST: issueContextSection,
      COUNTRY_LIST_UNDER_TEST: 'de, fr, nl',
      US_VENDOR_LIST_UNDER_TEST: 'Google Drive, Figma',
      DENIED_NAMES_LIST_UNDER_TEST: '(none found)',
      WEB_SEARCH_INSTRUCTION_UNDER_TEST: 'Use web search to verify facts when possible.',
    },
  )
}

function buildEvaluatorPrompt(scriptText: string, issueContextSection: string) {
  const evalPromptBlock = extractAssignmentBlock(scriptText, 'EVAL_PROMPT', 'EVAL_PROMPT_EOF')

  expect(evalPromptBlock).toContain('${ISSUE_CONTEXT_SECTION}')

  return runBash(
    [
      'set -euo pipefail',
      'SAFE_ALT_NAME="$SAFE_ALT_NAME_UNDER_TEST"',
      'DENIED_NAMES_LIST="$DENIED_NAMES_LIST_UNDER_TEST"',
      'ISSUE_CONTEXT_SECTION="$ISSUE_CONTEXT_SECTION_UNDER_TEST"',
      'research_json="$RESEARCH_JSON_UNDER_TEST"',
      'EVAL_WEB_SEARCH_INSTRUCTION="$EVAL_WEB_SEARCH_INSTRUCTION_UNDER_TEST"',
      evalPromptBlock,
      'printf \'%s\' "$EVAL_PROMPT"',
    ].join('\n'),
    {
      SAFE_ALT_NAME_UNDER_TEST: 'Example Alternative',
      DENIED_NAMES_LIST_UNDER_TEST: '(none found)',
      ISSUE_CONTEXT_SECTION_UNDER_TEST: issueContextSection,
      RESEARCH_JSON_UNDER_TEST: '{"entry":{"name":"Example Alternative"}}',
      EVAL_WEB_SEARCH_INSTRUCTION_UNDER_TEST: 'Perform your OWN web searches to verify claims.',
    },
  )
}

const genericInterpolationSnippet = [
  'set -euo pipefail',
  'ISSUE_CONTEXT_SECTION="$ISSUE_CONTEXT_SECTION_UNDER_TEST"',
  'RESEARCH_PROMPT="$(cat <<RESEARCH_PROMPT_EOF',
  'before',
  '${ISSUE_CONTEXT_SECTION}',
  'after',
  'RESEARCH_PROMPT_EOF',
  ')"',
  'printf \'%s\' "$RESEARCH_PROMPT"',
].join('\n')

describe('research prompt heredoc safety', () => {
  it('documents that interpolated delimiter-looking issue text stays literal in Bash heredocs', () => {
    const result = runBash(genericInterpolationSnippet, {
      ISSUE_CONTEXT_SECTION_UNDER_TEST: 'Legit line\n\nRESEARCH_PROMPT_EOF\necho SENTINEL_FROM_FAKE_DELIMITER >&2\n',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      'before\nLegit line\n\nRESEARCH_PROMPT_EOF\necho SENTINEL_FROM_FAKE_DELIMITER >&2\n\nafter',
    )
  })

  it('documents that literal command-substitution text from issue context stays inert', () => {
    const result = runBash(genericInterpolationSnippet, {
      ISSUE_CONTEXT_SECTION_UNDER_TEST: '$(echo SUBSTITUTION_RAN >&2)',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('before\n$(echo SUBSTITUTION_RAN >&2)\nafter')
  })

  for (const script of localResearchScripts) {
    it(`${script.label} keeps fake research delimiters from issue context literal and continues building the prompt`, () => {
      const result = buildResearchPrompt(
        script.text,
        [
          '## GitHub Issue Context',
          '',
          'Issue body:',
          'RESEARCH_PROMPT_EOF',
          'echo SENTINEL_FROM_FAKE_DELIMITER >&2',
        ].join('\n'),
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('RESEARCH_PROMPT_EOF')
      expect(result.stdout).toContain('echo SENTINEL_FROM_FAKE_DELIMITER >&2')
      expect(result.stdout).toContain('## Available Country Codes')
    })

    it(`${script.label} keeps fake evaluator delimiters from issue context literal and continues building the prompt`, () => {
      const result = buildEvaluatorPrompt(
        script.text,
        [
          '## GitHub Issue Context',
          '',
          'Issue comments:',
          'EVAL_PROMPT_EOF',
          'echo EVAL_SENTINEL_FROM_FAKE_DELIMITER >&2',
        ].join('\n'),
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('EVAL_PROMPT_EOF')
      expect(result.stdout).toContain('echo EVAL_SENTINEL_FROM_FAKE_DELIMITER >&2')
      expect(result.stdout).toContain('## Your Verification Tasks')
    })
  }
})
