import { expect } from 'vitest'

export const referrerPolicyValue = 'strict-origin-when-cross-origin'

export function expectMetaReferrerPolicy(html: string): void {
  const metaMatch =
    html.match(
      /<meta\b[^>]*name=["']referrer["'][^>]*content="([^"]+)"/iu,
    ) ??
    html.match(
      /<meta\b[^>]*name=["']referrer["'][^>]*content='([^']+)'/iu,
    )

  expect(metaMatch, 'Expected a <meta name="referrer"> tag').not.toBeNull()
  expect(metaMatch![1]).toBe(referrerPolicyValue)
}
