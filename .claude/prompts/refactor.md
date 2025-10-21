You are refactoring code in Claude Context.

## Steps:
1. **Identify the code smell**: What needs improvement and why
2. **Plan the refactoring**: Design the improved structure
3. **Ensure tests exist**: Add tests if missing before refactoring
4. **Make incremental changes**: Small, safe refactoring steps
5. **Run tests after each step**: Verify nothing breaks
6. **Update documentation**: Reflect any API changes
7. **Run CI checks**: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`
8. **Create commit**: Use "refactor:" prefix in commit message

## Guidelines:
- Don't change behavior, only structure
- Keep commits small and focused
- Run tests frequently during refactoring
- Update type definitions if needed
- Maintain backward compatibility for public APIs
- Extract reusable code into shared utilities

## Common Refactorings:
- Extract method/function
- Rename for clarity
- Remove duplication
- Simplify complex conditionals
- Improve type safety
- Split large files/classes
- Move code to appropriate packages

## Safety:
- Ensure all tests pass before and after
- Use TypeScript to catch breaking changes
- Review git diff carefully before committing
- Consider impact on dependent packages
