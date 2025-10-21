You are fixing a bug in Claude Context.

## Steps:
1. **Reproduce the bug**: Understand the issue and how to trigger it
2. **Locate the cause**: Find the root cause in the codebase
3. **Design the fix**: Plan the minimal change to fix the issue
4. **Implement the fix**: Make the necessary code changes
5. **Add regression test**: Prevent the bug from reoccurring
6. **Verify the fix**: Test that the bug is fixed and nothing else broke
7. **Run CI checks**: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`
8. **Create commit**: Use "fix:" prefix in commit message

## Investigation:
- Check error messages and stack traces
- Look for similar issues in GitHub issues
- Review recent changes that might have caused it
- Check if it's environment-specific (OS, Node version)

## Testing:
- Verify the bug is fixed
- Test edge cases related to the bug
- Run full test suite to catch regressions
- Test on multiple platforms if relevant

## Documentation:
- Update docs if the bug was due to unclear documentation
- Add comments explaining the fix if the code is subtle
- Update CHANGELOG if this is a significant bug
