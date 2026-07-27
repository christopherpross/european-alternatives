# Issue #309 Finalization

Date: 2026-03-20

## Summary

Finalized the fix for issue `#309` by moving the API response cache out of shared `/tmp`, rejecting unsafe cache directories and cache files, refusing malformed cached JSON, and adding regression coverage for the new hardening checks.

## Commands Run

- `gh issue view 309 --comments`
- `git status --short --branch`
- `git diff -- api/cache.php`
- `git diff -- tests/api-response-hsts.test.ts`
- `sed -n '1,260p' tests/api-cache-security.test.ts`
- `sed -n '1,260p' api/cache.php`
- `npm run lint`
- `npx tsc --noEmit --project tsconfig.app.json`
- `npm run test`
- `npm run build`
- `git restore dist`
- `git add api/cache.php tests/api-response-hsts.test.ts tests/api-cache-security.test.ts logs/issues/309/finalization.md`
- `git add -f logs/issues/309/finalization.md`
- `git reset HEAD dist/`
- `git diff --cached --stat`
- `git commit -F logs/issues/309/commit-message.txt`
- `git push origin main`
- `gh issue close 309 --comment "Fixed on main: moved the API cache into private account storage, reject unsafe cache paths, and added regression tests."`

## Final Git Status

```text
## main...origin/main
```

Working tree clean after push.
